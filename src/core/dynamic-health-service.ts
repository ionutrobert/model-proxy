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
    maxModelsPerProvider: number = 30
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

          const checks = modelsToCheck.map(model => this.checkModelHealth(provider, model));
          const results = await Promise.allSettled(checks);
          
          for (const result of results) {
            if (result.status === 'fulfilled') {
              healthResults.push(result.value);
              if (result.value.status === 'healthy') {
                allModels.push(modelsToCheck[results.indexOf(result)]);
              }
            }
          }
        } else {
          const modelConfigs = this.convertDiscoveredModels(
            discoveryResult.models,
            provider
          );

          this.modelCache.set(provider.id, modelConfigs);

          const prioritizedModels = this.prioritizeModelsForCheck(modelConfigs);
          const modelsToCheck = prioritizedModels.slice(0, maxModelsPerProvider);

          console.log(`[HEALTH] ${provider.name}: Checking ${modelsToCheck.length} prioritized models`);
          const checks = modelsToCheck.map(model => this.checkModelHealth(provider, model));
          const results = await Promise.allSettled(checks);

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
              healthResults.push(result.value);
              if (result.value.status === 'healthy') {
                allModels.push(modelsToCheck[i]);
              }
            }
          }
        }
      } catch (error) {
        console.error(`[HEALTH] ${provider.name}: Discovery failed:`, error);
        const fallbackModels = await this.getFallbackModels(provider);
        const modelsToCheck = fallbackModels.slice(0, maxModelsPerProvider);

        const checks = modelsToCheck.map(model => this.checkModelHealth(provider, model));
        const results = await Promise.allSettled(checks);
        
        for (const result of results) {
          if (result.status === 'fulfilled') {
            healthResults.push(result.value);
            if (result.value.status === 'healthy') {
              allModels.push(modelsToCheck[results.indexOf(result)]);
            }
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

  private prioritizeModelsForCheck(models: ModelConfig[]): ModelConfig[] {
    const priorityOrder = [
      'kimi-k2.5', 'kimi-k2', 'glm5', 'glm4',
      'deepseek-v3', 'deepseek-r1',
      'llama-3.1-405b', 'llama-3.1-70b', 'llama-3.3-70b',
      'mistral-large', 'mistral-medium',
      'qwen3', 'qwen2.5',
      'nemotron-ultra', 'nemotron-70b',
    ];

    return models.sort((a, b) => {
      const aPriority = priorityOrder.findIndex(p => a.id.toLowerCase().includes(p));
      const bPriority = priorityOrder.findIndex(p => b.id.toLowerCase().includes(p));

      if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
      if (aPriority !== -1) return -1;
      if (bPriority !== -1) return 1;

      const tierOrder = { 'S+': 0, 'S': 1, 'A+': 2, 'A': 3, 'A-': 4, 'B+': 5, 'B': 6, 'C': 7 };
      return tierOrder[a.tier] - tierOrder[b.tier];
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
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30000),
      });

      result.latency = Date.now() - startTime;

      if (response.ok) {
        result.status = 'healthy';
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ✓ ${model.id} (${result.latency}ms)`);
      } else if (response.status === 401 || response.status === 403) {
        result.status = 'healthy';
        result.error = `Auth OK, model available (HTTP ${response.status})`;
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ✓ ${model.id} - Auth validated`);
      } else if (response.status === 404) {
        result.status = 'error';
        result.error = 'Model not found';
        console.log(`[HEALTH] ✗ ${model.id}: Not found`);
      } else if (response.status === 400) {
        result.status = 'healthy';
        result.error = `Model available (HTTP 400 - likely rate limit)`;
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ✓ ${model.id} - Available (rate limited)`);
      } else if (response.status === 429) {
        result.status = 'healthy';
        result.error = `Model available (rate limited)`;
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ✓ ${model.id} - Available (rate limited)`);
      } else {
        result.status = 'healthy';
        result.error = `HTTP ${response.status}`;
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ? ${model.id}: HTTP ${response.status} (assuming available)`);
      }
    } catch (error) {
      result.latency = Date.now() - startTime;
      if (error instanceof Error && error.name === 'AbortError') {
        result.status = 'healthy';
        result.error = 'Timeout (assuming available)';
        circuitBreaker.recordSuccess(provider.id);
        console.log(`[HEALTH] ? ${model.id}: Timeout (assuming available)`);
      } else {
        result.status = 'error';
        result.error = error instanceof Error ? error.message : 'Unknown error';
        console.log(`[HEALTH] ✗ ${model.id}: ${result.error}`);
      }
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
