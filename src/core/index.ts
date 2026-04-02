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
import { healthService } from './health-service.js';
import { modelSelector } from './model-selector.js';
import { circuitBreaker } from './circuit-breaker.js';
import { BaseProvider } from '../providers/base.js';
import { createProvider } from '../providers/index.js';

export class ModelProxyCore {
  private providers: Map<ProviderId, BaseProvider> = new Map();
  private rankedModels: RankedModel[] = [];
  private healthResults: HealthCheckResult[] = [];
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.initialize();
  }

  /**
   * Initialize the proxy with configured providers
   */
  private initialize(): void {
    // Clear existing providers
    this.providers.clear();

    // Create provider instances
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

  /**
   * Refresh health status of all providers
   */
  async refreshHealth(): Promise<void> {
    const models = ProviderRegistry.getAllModels(this.config.providers);
    
    this.healthResults = await healthService.checkAllProviders(
      this.config.providers,
      models
    );

    this.rankedModels = modelSelector.rankModels(
      models,
      this.healthResults,
      this.config.preferences
    );

    console.log(`Health check complete. ${this.rankedModels.length} models available.`);
    
    // Log top models
    for (let i = 0; i < Math.min(5, this.rankedModels.length); i++) {
      const rm = this.rankedModels[i];
      console.log(
        `  ${i + 1}. ${rm.model.name} (${rm.model.provider}) - ` +
        `Score: ${rm.stabilityScore.toFixed(1)}, Latency: ${rm.health.latency}ms`
      );
    }
  }

  /**
   * Execute a chat completion request
   */
  async execute(
    request: ChatCompletionRequest,
    options?: { task?: 'simple' | 'complex' | 'critical' }
  ): Promise<ChatCompletionResponse> {
    // Ensure we have health data
    if (this.rankedModels.length === 0) {
      await this.refreshHealth();
    }

    // Select best model
    let selected: RankedModel | null = null;
    const task = options?.task;
    
    console.log(`\n🤖 Executing chat completion${task ? ` (task: ${task})` : ''}`);
    console.log(`📊 Available models: ${this.rankedModels.length}`);

    if (task) {
      selected = modelSelector.selectModelForTask(
        task,
        this.rankedModels,
        this.config.preferences
      );
      console.log(`🎯 Task-based selection (${task}):`);
    } else {
      selected = modelSelector.selectBestModel(
        this.rankedModels,
        undefined,
        this.config.preferences
      );
      console.log(`🎯 Best model selection:`);
    }

    if (!selected) {
      throw new Error('No healthy models available');
    }

    // Log selection details
    console.log(`✅ Selected: ${selected.model.name}`);
    console.log(`   Provider: ${selected.model.provider}`);
    console.log(`   Model ID: ${selected.model.id}`);
    console.log(`   Tier: ${selected.tier}`);
    console.log(`   Latency: ${selected.health.latency}ms`);
    console.log(`   Score: ${selected.stabilityScore.toFixed(1)}`);
    console.log(`   Context: ${selected.model.contextWindow.toLocaleString()} tokens`);
    if (selected.model.supportsStreaming) {
      console.log(`   Streaming: ✓`);
    }
    if (selected.model.supportsFunctionCalling) {
      console.log(`   Function calling: ✓`);
    }

    // Get provider
    const provider = this.providers.get(selected.model.provider);
    if (!provider) {
      throw new Error(`Provider ${selected.model.provider} not found`);
    }

    // Update request with selected model
    const updatedRequest = {
      ...request,
      model: selected.model.id,
    };

    // Execute with fallback
    const fallbackChain = modelSelector.getFallbackChain(this.rankedModels, 3);
    if (fallbackChain.length > 1) {
      console.log(`⛓️ Fallback chain (${fallbackChain.length} models):`);
      fallbackChain.forEach((m, i) => {
        console.log(`   ${i + 1}. ${m.model.name} (${m.health.latency}ms)`);
      });
    }
    console.log('');

    return this.executeWithFallback(updatedRequest, fallbackChain);
  }

  /**
   * Execute a streaming chat completion request
   */
  async executeStreaming(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (this.rankedModels.length === 0) {
      await this.refreshHealth();
    }

    // Filter to streaming-capable models
    const streamingModels = this.rankedModels.filter(r => r.model.supportsStreaming);
    
    if (streamingModels.length === 0) {
      throw new Error('No streaming-capable models available');
    }

    const fallbackChain = modelSelector.getFallbackChain(streamingModels, 3);
    
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
        circuitBreaker.recordFailure(rankedModel.model.provider, errorMessage);
        
        if (onError) {
          onError(error instanceof Error ? error : new Error(errorMessage));
        }
      }
    }

    throw new Error('All providers failed for streaming request');
  }

  /**
   * Execute with fallback chain
   */
  private async executeWithFallback(
    request: ChatCompletionRequest,
    fallbackChain: RankedModel[]
  ): Promise<ChatCompletionResponse> {
    const errors: string[] = [];

    for (const rankedModel of fallbackChain) {
      const provider = this.providers.get(rankedModel.model.provider);
      if (!provider) continue;

      try {
        const response = await provider.execute({
          ...request,
          model: rankedModel.model.id,
        });
        
        // Record success
        circuitBreaker.recordSuccess(rankedModel.model.provider);
        return response;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${rankedModel.model.name}: ${errorMessage}`);
        
        // Record failure
        circuitBreaker.recordFailure(rankedModel.model.provider, errorMessage);
      }
    }

    throw new Error(`All providers failed: ${errors.join('; ')}`);
  }

  /**
   * Get all available models
   */
  getAvailableModels(): ModelConfig[] {
    return this.rankedModels.map(r => r.model);
  }

  /**
   * Get health status
   */
  getHealthStatus(): {
    models: RankedModel[];
    providers: import('./types.js').ProviderHealth[];
    summary: ReturnType<import('./health-service.js').HealthService['getHealthSummary']>;
  } {
    return {
      models: this.rankedModels,
      providers: circuitBreaker.getHealthStatus(),
      summary: healthService.getHealthSummary.bind(healthService)(this.healthResults),
    };
  }

  /**
   * Get configuration
   */
  getConfig(): ProxyConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ProxyConfig>): void {
    this.config = { ...this.config, ...config };
    this.initialize();
  }

  /**
   * Force refresh health
   */
  async forceHealthRefresh(): Promise<void> {
    healthService.invalidateCache();
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
