import { 
  HealthCheckResult, 
  ProviderConfig, 
  ModelConfig, 
  ProviderId,
} from './types.js';
import { circuitBreaker } from './circuit-breaker.js';
import { getConfig } from './config.js';

// ============================================================================
// Health Check Service
// ============================================================================

interface CachedHealth {
  results: HealthCheckResult[];
  timestamp: number;
}

export class HealthService {
  private cache: CachedHealth | null = null;

  /**
   * Check health of a specific provider-model combination
   */
  async checkProviderHealth(
    provider: ProviderConfig,
    model: ModelConfig
  ): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const result: HealthCheckResult = {
      providerId: provider.id,
      modelId: model.id,
      status: 'healthy',
      latency: 0,
      timestamp: startTime,
    };

    try {
      // Try a simple GET request first (models endpoint)
      // This is more reliable than chat completion for health checks
      const modelsResponse = await fetch(`${provider.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
        signal: AbortSignal.timeout(provider.healthCheckTimeout),
      });

      const latency = Date.now() - startTime;
      result.latency = latency;

      if (modelsResponse.ok) {
        result.status = 'healthy';
        circuitBreaker.recordSuccess(provider.id);
      } else if (modelsResponse.status === 404) {
        // Fallback: Try chat completion with max_tokens: 1
        try {
          const chatResponse = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`,
              ...provider.headers,
            },
            body: JSON.stringify({
              model: model.id,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1,
            }),
            signal: AbortSignal.timeout(provider.healthCheckTimeout),
          });

          const chatLatency = Date.now() - startTime;
          result.latency = chatLatency;

          if (chatResponse.ok) {
            result.status = 'healthy';
            circuitBreaker.recordSuccess(provider.id);
          } else {
            // If both fail, provider is healthy but model is not available
            result.status = 'healthy';
            result.error = `Model not available (HTTP ${chatResponse.status})`;
            // Don't record failure - provider is up, just model unavailable
            circuitBreaker.recordSuccess(provider.id);
          }
    } catch (chatError) {
      result.status = 'error';
      result.error = chatError instanceof Error ? chatError.message : 'Health check failed';
      circuitBreaker.recordFailure(provider.id, result.error);
    }
  } else {
    result.status = 'error';
    result.error = `HTTP ${modelsResponse.status}: ${modelsResponse.statusText}`;
    circuitBreaker.recordFailure(provider.id, result.error);
  }
    } catch (error) {
      const latency = Date.now() - startTime;
      result.latency = latency;

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          result.status = 'timeout';
          result.error = 'Health check timed out';
        } else if (error.message.includes('fetch')) {
          result.status = 'error';
          result.error = 'Network error: Unable to reach provider';
        } else {
          result.status = 'error';
          result.error = error.message;
        }
        circuitBreaker.recordFailure(provider.id, result.error);
      }
    }

    return result;
  }

  /**
   * Check all providers in parallel
   */
  async checkAllProviders(
    providers: ProviderConfig[],
    models: ModelConfig[]
  ): Promise<HealthCheckResult[]> {
    const config = getConfig();

    // Return cached results if still valid
    if (this.cache && Date.now() - this.cache.timestamp < config.healthCheck.cacheTtlMs) {
      return this.cache.results;
    }

    // Run health checks in parallel
    const checks: Promise<HealthCheckResult[]>[] = providers.map(async (provider) => {
      const providerModels = models.filter(m => m.provider === provider.id);

      // Only check models from available providers
      if (!circuitBreaker.isAvailable(provider.id)) {
        return providerModels.map(model => ({
          providerId: provider.id,
          modelId: model.id,
          status: 'unhealthy' as const,
          latency: 0,
          timestamp: Date.now(),
          error: 'Circuit breaker open',
        }));
      }

      // Check first 3 models from each provider
      const modelsToCheck = providerModels.slice(0, 3);
      return Promise.all(
        modelsToCheck.map(model => this.checkProviderHealth(provider, model))
      );
    });

    const results = (await Promise.all(checks)).flat();
    
    this.cache = {
      results,
      timestamp: Date.now(),
    };

    return results;
  }

  /**
   * Check a specific provider only
   */
  async checkProvider(
    provider: ProviderConfig,
    models: ModelConfig[]
  ): Promise<HealthCheckResult[]> {
    const providerModels = models.filter(m => m.provider === provider.id);
    
    if (!circuitBreaker.isAvailable(provider.id)) {
      return providerModels.map(model => ({
        providerId: provider.id,
        modelId: model.id,
        status: 'unhealthy' as const,
        latency: 0,
        timestamp: Date.now(),
        error: 'Circuit breaker open',
      }));
    }

    const modelsToCheck = providerModels.slice(0, 3);
    return Promise.all(
      modelsToCheck.map(model => this.checkProviderHealth(provider, model))
    );
  }

  /**
   * Invalidate the cache
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Get cached results
   */
  getCachedResults(): HealthCheckResult[] | null {
    return this.cache?.results || null;
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(): boolean {
    if (!this.cache) return false;
    const config = getConfig();
    return Date.now() - this.cache.timestamp < config.healthCheck.cacheTtlMs;
  }

  /**
   * Force refresh health checks
   */
  async forceRefresh(
    providers: ProviderConfig[],
    models: ModelConfig[]
  ): Promise<HealthCheckResult[]> {
    this.invalidateCache();
    return this.checkAllProviders(providers, models);
  }

  /**
   * Get health summary
   */
  getHealthSummary(results: HealthCheckResult[]): {
    total: number;
    healthy: number;
    unhealthy: number;
    timeout: number;
    error: number;
    byProvider: Record<ProviderId, { healthy: number; unhealthy: number }>;
  } {
    const byProvider: Record<ProviderId, { healthy: number; unhealthy: number }> = {};
    
    let healthy = 0;
    let unhealthy = 0;
    let timeout = 0;
    let error = 0;

    for (const result of results) {
      if (!byProvider[result.providerId]) {
        byProvider[result.providerId] = { healthy: 0, unhealthy: 0 };
      }

      if (result.status === 'healthy') {
        healthy++;
        byProvider[result.providerId].healthy++;
      } else {
        unhealthy++;
        byProvider[result.providerId].unhealthy++;
        
        if (result.status === 'timeout') timeout++;
        if (result.status === 'error') error++;
      }
    }

    return {
      total: results.length,
      healthy,
      unhealthy,
      timeout,
      error,
      byProvider,
    };
  }
}

// Global health service instance
export const healthService = new HealthService();
