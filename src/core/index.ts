// ============================================================================
// Core Module - Framework-agnostic model proxy functionality
// ============================================================================

// Types
export * from './types.js';

// Configuration
export {
  ConfigManager,
  createProxyConfig,
  getConfig,
} from './config.js';

// Provider Registry
export {
  ProviderRegistry,
  PROVIDER_DEFINITIONS,
} from './provider-registry.js';

// Circuit Breaker
export {
  CircuitBreaker,
  circuitBreaker,
  isHealthy,
  isAvailable,
  recordSuccess,
  recordFailure,
} from './circuit-breaker.js';

// Health Service
export {
  HealthService,
  healthService,
} from './health-service.js';

// Model Selector
export {
  ModelSelector,
  modelSelector,
} from './model-selector.js';

// Dynamic Discovery
export {
  ModelDiscovery,
  modelDiscovery,
} from './model-discovery.js';

export {
  DynamicHealthService,
  dynamicHealthService,
} from './dynamic-health-service.js';

export {
  SmartModelSelector,
  smartModelSelector,
} from './smart-selector.js';

// ============================================================================
// Main Model Proxy Class
// ============================================================================

import {
  ProxyConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelConfig,
  HealthCheckResult,
  RankedModel,
  ProviderId,
} from './types.js';
import { ProviderRegistry } from './provider-registry.js';
import { dynamicHealthService } from './dynamic-health-service.js';
import { smartModelSelector, SelectionMode } from './smart-selector.js';
import { circuitBreaker } from './circuit-breaker.js';
import { BaseProvider } from '../providers/base.js';
import { createProvider } from '../providers/index.js';
import { healthTracker } from './health-tracker.js';

export class ModelProxyCore {
  private providers: Map<ProviderId, BaseProvider> = new Map();
  private rankedModels: RankedModel[] = [];
  private healthResults: HealthCheckResult[] = [];
  private allModels: ModelConfig[] = [];
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    this.providers.clear();

    for (const providerConfig of this.config.providers) {
      try {
        const provider = createProvider(providerConfig);
        this.providers.set(providerConfig.id, provider);
      } catch (error) {
        console.error(`Failed to initialize provider ${providerConfig.id}:`, error);
      }
    }

    console.log(`Initialized ${this.providers.size} provider(s)`);
  }

  async refreshHealth(): Promise<void> {
    console.log('\n🔍 Discovering and checking providers...');

    const result = await dynamicHealthService.discoverAndCheckProviders(
      this.config.providers,
      15
    );

    this.healthResults = result.healthResults;
    this.allModels = result.allModels;

    // Sync health data into our health tracker for auto-modes
    for (const hr of result.healthResults) {
      if (hr.status === 'healthy' && hr.latency > 0) {
        healthTracker.recordRequest(hr.modelId, hr.providerId, {
          latency: hr.latency,
          statusCode: '200',
          success: true,
        });
      } else if (hr.status === 'unhealthy') {
        healthTracker.recordRequest(hr.modelId, hr.providerId, {
          latency: hr.latency > 0 ? hr.latency : 0,
          statusCode: hr.latency === 0 ? 'ERR' : '500',
          success: false,
        });
      } else if (hr.status === 'timeout') {
        healthTracker.recordRequest(hr.modelId, hr.providerId, {
          latency: 0,
          statusCode: '000',
          success: false,
        });
      }
    }

    this.rankedModels = smartModelSelector.rankModels(
      this.allModels,
      this.healthResults,
      this.config.preferences
    );

    console.log(`\n✅ Health check complete.`);
    console.log(`📊 Available models: ${this.rankedModels.length}`);

    if (this.rankedModels.length > 0) {
      console.log('\n🏆 Top models:');
      for (let i = 0; i < Math.min(5, this.rankedModels.length); i++) {
        const rm = this.rankedModels[i];
        console.log(
          ` ${i + 1}. ${rm.model.name} (${rm.model.provider}) - ` +
          `Tier: ${rm.tier}, Context: ${rm.model.contextWindow.toLocaleString()}, ` +
          `Latency: ${rm.health.latency}ms`
        );
      }
    }
  }

  async execute(
    request: ChatCompletionRequest,
    options?: { task?: 'simple' | 'complex' | 'critical'; mode?: SelectionMode; useAutoSelection?: boolean }
  ): Promise<ChatCompletionResponse> {
    if (this.rankedModels.length === 0) {
      await this.refreshHealth();
    }

    if (this.rankedModels.length === 0) {
      throw new Error('No healthy models available. Check your API keys and network.');
    }

    // Direct model execution when specific model is requested
    const useAutoSelection = options?.useAutoSelection !== false;
    if (!useAutoSelection && request.model) {
      const modelId = request.model;
      console.log(`\n🎯 Direct execution for model: ${modelId}`);

      const modelConfig = this.allModels.find(m => m.id === modelId);
      if (!modelConfig) {
        throw new Error(`Model ${modelId} not found in available models`);
      }

      const provider = this.providers.get(modelConfig.provider);
      if (!provider) {
        throw new Error(`Provider ${modelConfig.provider} not initialized`);
      }

      const startTime = performance.now();
      try {
        const response = await provider.execute({ ...request, model: modelId });
        const latency = Math.round(performance.now() - startTime);
        healthTracker.recordRequest(modelId, modelConfig.provider, {
          latency,
          statusCode: '200',
          success: true,
        });
        return response;
      } catch (error) {
        const latency = Math.round(performance.now() - startTime);
        const msg = error instanceof Error ? error.message : String(error);
        let statusCode = 'ERR';
        let success = false;
        if (msg.includes('401') || msg.includes('403')) { statusCode = '401'; success = true; }
        else if (msg.includes('429')) { statusCode = '429'; success = false; }
        else if (msg.includes('404')) { statusCode = '404'; success = false; }
        else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) { statusCode = '000'; success = false; }
        healthTracker.recordRequest(modelId, modelConfig.provider, { latency, statusCode, success });
        throw error;
      }
    }

    const mode = options?.mode || 'best';
    console.log(`\n🤖 Executing request (mode: ${mode})`);

    const selectionResult = smartModelSelector.selectForMode(
      mode,
      this.rankedModels,
      this.config.preferences
    );

    if (!selectionResult) {
      throw new Error('No suitable model found for request');
    }

    const selected = selectionResult.model;
    console.log(`✅ Selected: ${selected.model.name}`);
    console.log(` Provider: ${selected.model.provider}`);
    console.log(` Model ID: ${selected.model.id}`);
    console.log(` Tier: ${selected.tier}`);
    console.log(` Context: ${selected.model.contextWindow.toLocaleString()} tokens`);
    console.log(` Latency: ${selected.health.latency}ms`);

    if (selectionResult.alternatives.length > 0) {
      console.log(` Alternatives: ${selectionResult.alternatives.map(a => a.model.name).join(', ')}`);
    }

    const provider = this.providers.get(selected.model.provider);
    if (!provider) {
      throw new Error(`Provider ${selected.model.provider} not initialized`);
    }

    const fallbackChain = smartModelSelector.getFallbackChain(this.rankedModels, 3);
    console.log(`⛓️ Fallback chain: ${fallbackChain.map(m => m.model.name).join(' → ')}`);

    return this.executeWithFallback(
      { ...request, model: selected.model.id },
      fallbackChain
    );
  }

  async executeStreaming(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void,
    mode?: SelectionMode
  ): Promise<void> {
    if (this.rankedModels.length === 0) {
      await this.refreshHealth();
    }

    const streamingModels = this.rankedModels.filter(r => r.model.supportsStreaming);
    if (streamingModels.length === 0) {
      throw new Error('No streaming-capable models available');
    }

    const selectionResult = smartModelSelector.selectForMode(
      mode || 'best',
      streamingModels
    );

    if (!selectionResult) {
      throw new Error('No streaming model available');
    }

    const fallbackChain = smartModelSelector.getFallbackChain(streamingModels, 3);

    for (const rankedModel of fallbackChain) {
      const provider = this.providers.get(rankedModel.model.provider);
      if (!provider) continue;

      try {
        await provider.executeStreaming(
          { ...request, model: rankedModel.model.id },
          onChunk,
          onComplete,
          onError
        );

        circuitBreaker.recordSuccess(rankedModel.model.provider);
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Stream error from ${rankedModel.model.name}: ${errorMessage}`);
        circuitBreaker.recordFailure(rankedModel.model.provider, errorMessage);

        if (onError && fallbackChain.indexOf(rankedModel) === fallbackChain.length - 1) {
          onError(error instanceof Error ? error : new Error(errorMessage));
        }
      }
    }

    throw new Error('All providers failed for streaming request');
  }

  private async executeWithFallback(
    request: ChatCompletionRequest,
    fallbackChain: RankedModel[]
  ): Promise<ChatCompletionResponse> {
    const errors: string[] = [];
    const startTime = performance.now();

    for (const rankedModel of fallbackChain) {
      const provider = this.providers.get(rankedModel.model.provider);
      if (!provider) continue;

      try {
        console.log(`\n⏳ Trying ${rankedModel.model.name}...`);
        const modelStartTime = performance.now();
        const response = await provider.execute({
          ...request,
          model: rankedModel.model.id,
        });
        const latency = Math.round(performance.now() - modelStartTime);

        circuitBreaker.recordSuccess(rankedModel.model.provider);
        healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
          latency,
          statusCode: '200',
          success: true,
        });
        console.log(`✓ Success with ${rankedModel.model.name} (${latency}ms)`);
        return response;
      } catch (error) {
        const latency = Math.round(performance.now() - startTime);
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${rankedModel.model.name}: ${errorMessage}`);
        console.error(`✗ ${rankedModel.model.name} failed: ${errorMessage}`);

        let statusCode = 'ERR';
        let success = false;
        if (errorMessage.includes('401') || errorMessage.includes('403')) { statusCode = '401'; success = true; }
        else if (errorMessage.includes('429')) { statusCode = '429'; success = false; }
        else if (errorMessage.includes('404')) { statusCode = '404'; success = false; }
        else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) { statusCode = '000'; success = false; }
        healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, { latency, statusCode, success });

        circuitBreaker.recordFailure(rankedModel.model.provider, errorMessage);
      }
    }

    throw new Error(`All providers failed:\n${errors.map((e, i) => ` ${i + 1}. ${e}`).join('\n')}`);
  }

  getAvailableModels(): ModelConfig[] {
    return this.allModels;
  }

  getRankedModels(): RankedModel[] {
    return this.rankedModels;
  }

  getHealthStatus(): { models: RankedModel[]; providers: import('./types.js').ProviderHealth[]; summary: { total: number; healthy: number; unhealthy: number }; } {
    const healthy = this.healthResults.filter(r => r.status === 'healthy').length;
    return {
      models: this.rankedModels,
      providers: circuitBreaker.getHealthStatus(),
      summary: {
        total: this.healthResults.length,
        healthy,
        unhealthy: this.healthResults.length - healthy,
      },
    };
  }

  getConfig(): ProxyConfig {
    return this.config;
  }

  updateConfig(config: Partial<ProxyConfig>): void {
    this.config = { ...this.config, ...config };
    this.initialize();
  }

  async forceHealthRefresh(): Promise<void> {
    dynamicHealthService.invalidateCache();
    await this.refreshHealth();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

import { createProxyConfig } from './config.js';

export function createModelProxy(
  options: {
    providers: Array<{
      id: ProviderId;
      apiKey: string;
      preference?: import('./types.js').ProviderPreference;
    }>;
    preferences?: Partial<import('./types.js').UserPreferences>;
    healthCheck?: {
      timeoutMs?: number;
      cacheTtlMs?: number;
      enabled?: boolean;
    };
  }
): ModelProxyCore {
  const config = createProxyConfig(options.providers, options.preferences);

  if (options.healthCheck) {
    config.healthCheck = {
      ...config.healthCheck,
      ...options.healthCheck,
    };
  }

  return new ModelProxyCore(config);
}
