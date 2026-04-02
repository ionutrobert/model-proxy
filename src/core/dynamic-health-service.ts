import {
  HealthCheckResult,
  ProviderConfig,
  ModelConfig,
  ProviderId,
} from './types.js';
import { circuitBreaker } from './circuit-breaker.js';
import { modelDiscovery, DiscoveredModel } from './model-discovery.js';

interface CachedHealth {
  results: HealthCheckResult[];
  timestamp: number;
}

interface ProviderModels {
  providerId: ProviderId;
  models: ModelConfig[];
  error?: string;
}

export class DynamicHealthService {
  private cache: CachedHealth | null = null;
  private modelCache: Map<ProviderId, ModelConfig[]> = new Map();

  async discoverAndCheckProviders(
    providers: ProviderConfig[],
    maxModelsPerProvider: number = 10
  ): Promise<{ healthResults: HealthCheckResult[]; allModels: ModelConfig[] }> {
    const allModels: ModelConfig[] = [];
    const healthResults: HealthCheckResult[] = [];

    const providerChecks = providers.map(async (provider) => {
      if (!circuitBreaker.isAvailable(provider.id)) {
        return;
      }

      try {
        const discoveryResult = await modelDiscovery.discoverProviderModels(provider);

        if (discoveryResult.error || discoveryResult.models.length === 0) {
          console.log(`[HEALTH] ${provider.name}: No models discovered, using fallback`);
          const fallbackModels = await this.getFallbackModels(provider);
          const modelsToCheck = fallbackModels.slice(0, maxModelsPerProvider);

          for (const model of modelsToCheck) {
            const result = await this.checkModelHealth(provider, model);
            healthResults.push(result);
            if (result.status === 'healthy') {
              allModels.push(model);
            }
          }
        } else {
          const modelConfigs = this.convertDiscoveredModels(
            discoveryResult.models,
            provider
          );

          this.modelCache.set(provider.id, modelConfigs);

          const modelsToCheck = modelConfigs.slice(0, maxModelsPerProvider);

          for (const model of modelsToCheck) {
            const result = await this.checkModelHealth(provider, model);
            healthResults.push(result);
            if (result.status === 'healthy') {
              allModels.push(model);
            }
          }
        }
      } catch (error) {
        console.error(`[HEALTH] ${provider.name}: Discovery failed:`, error);
        const fallbackModels = await this.getFallbackModels(provider);
        const modelsToCheck = fallbackModels.slice(0, maxModelsPerProvider);

        for (const model of modelsToCheck) {
          const result = await this.checkModelHealth(provider, model);
          healthResults.push(result);
          if (result.status === 'healthy') {
            allModels.push(model);
          }
        }
      }
    });

    await Promise.allSettled(providerChecks);

    this.cache = {
      results: healthResults,
      timestamp: Date.now(),
    };

    return { healthResults, allModels };
  }

  private convertDiscoveredModels(discovered: DiscoveredModel[], provider: ProviderConfig): ModelConfig[] {
    return discovered.map(dm => {
      const contextWindow = dm.context_window || modelDiscovery.inferContextWindow(dm.id);
      const capabilities = modelDiscovery.inferCapabilities(dm.id);
      const tier = modelDiscovery.estimateTier(dm.id);

      const model: ModelConfig = {
        id: dm.id,
        provider: provider.id,
        name: dm.name || dm.id,
        tier,
        contextWindow,
        supportsStreaming: dm.supports_streaming ?? capabilities.streaming,
        supportsFunctionCalling: dm.supports_function_calling ?? capabilities.functionCalling,
        supportsVision: dm.supports_vision ?? capabilities.vision,
      };

      if (dm.pricing?.prompt && dm.pricing?.completion) {
        model.costPer1kTokens = {
          input: dm.pricing.prompt,
          output: dm.pricing.completion,
        };
      }

      return model;
    });
  }

  private async getFallbackModels(provider: ProviderConfig): Promise<ModelConfig[]> {
    const fallbackModels: ModelConfig[] = [];
    const commonPrefixes = [
      'meta/llama-3.1-',
      'nvidia/llama-3.1-',
      'llama-3.1-',
      'meta-llama/',
    ];

    const commonModels = [
      { id: 'llama-3.1-70b-instruct', context: 128000 },
      { id: 'llama-3.1-8b-instruct', context: 128000 },
      { id: 'llama-3.1-405b-instruct', context: 128000 },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', context: 128000 },
      { id: 'meta/llama-3.1-70b-instruct', context: 128000 },
      { id: 'meta/llama-3.1-8b-instruct', context: 128000 },
      { id: 'meta/llama-3.1-405b-instruct', context: 128000 },
      { id: 'mistral-7b-instruct', context: 32768 },
      { id: 'mixtral-8x7b-instruct', context: 32768 },
      { id: 'mixtral-8x22b-instruct', context: 65536 },
    ];

    for (const model of commonModels) {
      fallbackModels.push({
        id: model.id,
        provider: provider.id,
        name: model.id,
        tier: modelDiscovery.estimateTier(model.id),
        contextWindow: model.context,
        supportsStreaming: true,
        supportsFunctionCalling: true,
      });
    }

    return fallbackModels;
  }

  async checkModelHealth(provider: ProviderConfig, model: ModelConfig): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const result: HealthCheckResult = {
      providerId: provider.id,
      modelId: model.id,
      status: 'healthy',
      latency: 0,
      timestamp: startTime,
    };

    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
          ...provider.headers,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(provider.healthCheckTimeout || 10000),
      });

      result.latency = Date.now() - startTime;

      if (response.ok) {
        result.status = 'healthy';
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ✓ ${model.id} (${result.latency}ms)`);
      } else if (response.status === 401 || response.status === 403) {
        result.status = 'error';
        result.error = `Auth error: HTTP ${response.status}`;
        console.log(`[HEALTH] ✗ ${model.id}: Auth error`);
      } else if (response.status === 404) {
        result.status = 'error';
        result.error = 'Model not found';
        console.log(`[HEALTH] ✗ ${model.id}: Not found`);
      } else if (response.status === 400) {
        const body = await response.text();
        if (body.includes('not found') || body.includes('does not exist')) {
          result.status = 'error';
          result.error = 'Model not available';
          console.log(`[HEALTH] ✗ ${model.id}: Not available`);
        } else {
          result.status = 'healthy';
          result.error = `HTTP ${response.status} (likely minor issue)`;
          circuitBreaker.recordSuccess(provider.id);
          console.log(`[HEALTH] ? ${model.id}: Minor issue (${response.status})`);
        }
      } else {
        result.status = 'error';
        result.error = `HTTP ${response.status}`;
        console.log(`[HEALTH] ✗ ${model.id}: HTTP ${response.status}`);
      }
    } catch (error) {
      result.latency = Date.now() - startTime;
      result.status = 'error';
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[HEALTH] ✗ ${model.id}: ${result.error}`);
    }

    return result;
  }

  getCachedModels(providerId: ProviderId): ModelConfig[] | null {
    return this.modelCache.get(providerId) || null;
  }

  invalidateCache(): void {
    this.cache = null;
    this.modelCache.clear();
  }

  isCacheValid(cacheTtlMs: number): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.timestamp < cacheTtlMs;
  }
}

export const dynamicHealthService = new DynamicHealthService();
