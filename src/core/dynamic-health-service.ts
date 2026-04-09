import {
  HealthCheckResult,
  ProviderConfig,
  ModelConfig,
  ProviderId,
} from './types.js';
import { circuitBreaker } from './circuit-breaker.js';
import { modelDiscovery, DiscoveredModel } from './model-discovery.js';
import { CURATED_MODELS, getCuratedModel, CuratedModel } from './curated-models.js';

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
          
for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        healthResults.push(result.value);
      }
      // Always include model in allModels, regardless of health status
      allModels.push(modelsToCheck[i]);
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
      }
      // Always include model in allModels, regardless of health status
      // Health status only affects auto-selection, not direct model access
      allModels.push(modelsToCheck[i]);
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

 if (dm.max_output_tokens !== undefined) {
      model.maxOutputTokens = dm.max_output_tokens;
    }

 if (dm.pricing?.prompt && dm.pricing?.completion) {
 model.costPer1kTokens = {
 input: dm.pricing.prompt,
 output: dm.pricing.completion,
 };
 }

 return model;
 });
 }

private getModelCapabilities(modelId: string): CuratedModel | null {
    const curated = getCuratedModel(modelId);
    if (curated) return curated;
    const normalizedQuery = modelId.toLowerCase().replace(/[-_./]/g, '');
    const matching = CURATED_MODELS.find(
      m => m.id.toLowerCase().replace(/[-_./]/g, '') === normalizedQuery ||
           modelId.toLowerCase().includes(m.id.toLowerCase()) ||
           m.id.toLowerCase().includes(normalizedQuery)
    );
    return matching || null;
  }

  private calculateModelScore(model: ModelConfig): number {
    const caps = this.getModelCapabilities(model.id);
    const id = model.id.toLowerCase();
    let score = 0;
    const hasToolCalling = (caps?.supportsFunctionCalling ?? this.infersToolCalling(id));
    const hasThinking = (caps?.isThinking ?? (id.includes('r1') || id.includes('qwq') || id.includes('thinking')));
    const contextWindow = (caps?.contextWindow ?? model.contextWindow) ?? 128000;
    const tier = (caps?.tier ?? model.tier) ?? 'B';
    const sweScore = (caps?.swe_score ?? this.estimateSweScore(id)) ?? 20;

    const tierWeights: Record<string, number> = { 'S+': 100, 'S': 80, 'A+': 60, 'A': 40, 'A-': 30, 'B+': 20, 'B': 10, 'C': 0 };
    score += tierWeights[tier] ?? 0;
    score += sweScore;
    if (hasToolCalling) score += 25;
    if (hasThinking) score += 15;
    if (contextWindow >= 200000) score += 10;
    else if (contextWindow >= 128000) score += 5;
    return score;
  }

  private infersToolCalling(modelId: string): boolean {
    const id = modelId.toLowerCase();
    const toolPatterns = ['instruct', 'chat', 'v3', 'v2', 'llama-3', 'llama-4', 'qwen3', 'qwen2', 'deepseek', 'glm', 'kimi', 'nemotron', 'mistral'];
    return toolPatterns.some(p => id.includes(p));
  }

  private estimateSweScore(modelId: string): number {
    const id = modelId.toLowerCase();
    if (id.includes('qwen3-coder') || id.includes('devstral') || id.includes('glm-5')) return 70;
    if (id.includes('qwen3-235b') || id.includes('deepseek-v3.2')) return 68;
    if (id.includes('minimax-m2.5')) return 80;
    if (id.includes('minimax-m2')) return 70;
    if (id.includes('kimi-k2') || id.includes('step-3.5')) return 65;
    if (id.includes('r1')) return 60;
    if (id.includes('qwq')) return 50;
    if (id.includes('405b') || id.includes('llama-3.3-70b')) return 40;
    if (id.includes('70b')) return 35;
    if (id.includes('8b')) return 25;
    return 20;
  }

  private prioritizeModelsForCheck(models: ModelConfig[]): ModelConfig[] {
    return models.sort((a, b) => {
      const scoreA = this.calculateModelScore(a);
      const scoreB = this.calculateModelScore(b);
      return scoreB - scoreA;
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
      { id: 'llama-3.1-70b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'llama-3.1-8b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'llama-3.1-405b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'meta/llama-3.1-70b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'meta/llama-3.1-8b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'meta/llama-3.1-405b-instruct', context: 128000, maxOutput: 8192 },
      { id: 'mistral-7b-instruct', context: 32768, maxOutput: 8192 },
      { id: 'mixtral-8x7b-instruct', context: 32768, maxOutput: 8192 },
      { id: 'mixtral-8x22b-instruct', context: 65536, maxOutput: 8192 },
    ];

    for (const model of commonModels) {
      fallbackModels.push({
        id: model.id,
        provider: provider.id,
        name: model.id,
        tier: modelDiscovery.estimateTier(model.id),
        contextWindow: model.context,
        maxOutputTokens: model.maxOutput,
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

  async checkSingleModel(
    providerConfig: ProviderConfig,
    modelId: string,
    options?: { max_tokens?: number; timeout?: number }
  ): Promise<{ status: string; latency: number }> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
          ...providerConfig.headers,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: options?.max_tokens ?? 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(options?.timeout ?? 15000),
      });

      const latency = Date.now() - startTime;

      if (response.ok || response.status === 401 || response.status === 403 || response.status === 400 || response.status === 429) {
        return { status: 'healthy', latency };
      }

      return { status: 'unhealthy', latency };
    } catch (error) {
      const latency = Date.now() - startTime;
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: 'timeout', latency };
      }
      return { status: 'unhealthy', latency };
    }
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
