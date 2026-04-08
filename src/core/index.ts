// ============================================================================
// Core Module - Simple Model Proxy
// Features: Health-based ranking, direct model selection, key rotation on 429
// NO: Verification loops, adaptive scoring, checkpointing, aggressive switching
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

export { modelHealthVerifier } from './model-health-verifier.js';

// ============================================================================
// Main Model Proxy Class (Simplified - No Orchestration)
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
  ModelNotFoundError,
} from './types.js';
import { ProviderRegistry } from './provider-registry.js';
import { dynamicHealthService } from './dynamic-health-service.js';
import { smartModelSelector, SelectionMode } from './smart-selector.js';
import { circuitBreaker } from './circuit-breaker.js';
import { BaseProvider } from '../providers/base.js';
import { createProvider } from '../providers/index.js';
import { healthTracker } from './health-tracker.js';
import { modelHealthVerifier } from './model-health-verifier.js';

export class ModelProxyCore {
  private providers: Map<ProviderId, BaseProvider> = new Map();
  private rankedModels: RankedModel[] = [];
  private healthResults: HealthCheckResult[] = [];
  private allModels: ModelConfig[] = [];
  private config: ProxyConfig;
  private lastRankingUpdate: number = 0;
  private rankingUpdateInterval: number = 30000; // Recompute every 30s minimum

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

    // Now verify models with actual ping requests
    console.log('\n🔧 Verifying model health with active pings...');
    await this.verifyModels();
  }

  private async verifyModels(): Promise<void> {
    // Build provider config map
    const providerConfigs = new Map<string, { baseUrl: string; apiKey: string }>();
    for (const provider of this.config.providers) {
      const key = provider.keyPool 
        ? provider.keyPool.keys[0].key 
        : provider.apiKey;
      providerConfigs.set(provider.id, {
        baseUrl: provider.baseUrl,
        apiKey: key,
      });
    }

    const getProviderConfig = (providerId: string) => {
      return providerConfigs.get(providerId) || null;
    };

    // Verify all models
    const result = await modelHealthVerifier.verifyAllModels(
      this.allModels,
      getProviderConfig
    );

    console.log(`\n✅ Verification complete: ${result.verified.length} verified, ${result.failed.length} failed`);

    // Log failed models
    if (result.failed.length > 0) {
      console.log('\n⚠️  Failed models (will be excluded from auto-selection):');
      for (const modelId of result.failed) {
        const status = modelHealthVerifier.getStatus(modelId);
        console.log(` - ${modelId}: ${status.status} (${status.consecutiveFailures} consecutive failures)`);
      }
    }
  }

  /**
   * Recompute rankings based on actual request performance
   * Called when significant latency deviation is detected
   */
  private updateRankingsFromRealLatency(): void {
    const now = Date.now();
    if (now - this.lastRankingUpdate < this.rankingUpdateInterval) {
      return; // Don't update too frequently
    }

    // Build updated health results from actual request data
    const updatedHealthResults: HealthCheckResult[] = [];

    for (const model of this.allModels) {
      const history = healthTracker.getHealth(model.id);
      if (history && history.metrics.totalRequests > 0) {
        const avgLatency = history.metrics.avgLatency;
        const verdict = history.verdict;

        updatedHealthResults.push({
          modelId: model.id,
          providerId: model.provider,
          status: verdict === 'Not Active' || verdict === 'Unstable' ? 'unhealthy' : 'healthy',
          latency: Math.round(avgLatency),
          timestamp: now,
        });
      }
    }

    // If we have enough real data, recompute rankings
    if (updatedHealthResults.length >= Math.min(3, this.allModels.length)) {
      const oldTop = this.rankedModels[0]?.model.id;

      this.rankedModels = smartModelSelector.rankModels(
        this.allModels,
        updatedHealthResults,
        this.config.preferences
      );

      const newTop = this.rankedModels[0]?.model.id;

      if (oldTop && newTop && oldTop !== newTop) {
        console.log(`📊 Rankings updated: ${oldTop} → ${newTop} (based on real latency)`);
      }

      this.lastRankingUpdate = now;
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

    // If a specific model is requested (excluding auto-modes already expanded in route), use it directly
    const forceAutoSelection = options?.useAutoSelection === true;
    if (request.model && !forceAutoSelection) {
      const modelId = request.model;
      console.log(`\n🎯 Direct execution for model: ${modelId}`);

      const modelConfig = this.allModels.find(m => m.id === modelId);

      // If model not found, throw 404 error (NO FALLBACK)
      if (!modelConfig) {
        throw new ModelNotFoundError(modelId);
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
        this.updateRankingsFromRealLatency();
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

        // NO FALLBACK - just throw the error
        console.error(`❌ Model ${modelId} failed: ${msg}`);
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

    // Execute directly - NO FALLBACK
    const startTime = performance.now();
    try {
      const response = await provider.execute({ ...request, model: selected.model.id });
      const latency = Math.round(performance.now() - startTime);

      healthTracker.recordRequest(selected.model.id, selected.model.provider, {
        latency,
        statusCode: '200',
        success: true,
      });
      this.updateRankingsFromRealLatency();
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
      healthTracker.recordRequest(selected.model.id, selected.model.provider, { latency, statusCode, success });

      // NO FALLBACK - just throw the error
      console.error(`❌ Model ${selected.model.id} failed: ${msg}`);
      throw error;
    }
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

    // If specific model requested, use it directly
    if (request.model) {
      const modelConfig = this.allModels.find(m => m.id === request.model);
      if (!modelConfig) {
        throw new Error(`Model ${request.model} not found. Available models: ${this.allModels.map(m => m.id).join(', ')}`);
      }
      if (!modelConfig.supportsStreaming) {
        throw new Error(`Model ${request.model} does not support streaming`);
      }

      const provider = this.providers.get(modelConfig.provider);
      if (!provider) {
        throw new Error(`Provider ${modelConfig.provider} not initialized`);
      }

      console.log(`\n🎯 Direct streaming for model: ${request.model}`);

      const KAWAII_FACES = [
        '(｡•́︿•̀｡)', '(◔_◔)', '(¬‿¬)', '(•_•)', '(・_・；)',
        '(￣ω￣)', '(⌐■_■)', '(◕‿◕)', '(｡◕‿◕｡)', '(✿◠‿◠)'
      ];
      const randomFace = KAWAII_FACES[Math.floor(Math.random() * KAWAII_FACES.length)];
      const displayPath = `[${modelConfig.provider}] ${request.model}`;
      const statusMsg = `\n${randomFace} ${displayPath}\n\n`;

      console.log(`[STREAM] Starting ${displayPath}`);

      onChunk({
        id: `status-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [{
          index: 0,
          delta: { content: statusMsg },
          finish_reason: null
        }]
      });

      const startTime = performance.now();
      try {
        await provider.executeStreaming(
          request,
          onChunk,
          () => {
            const latency = Math.round(performance.now() - startTime);
            healthTracker.recordRequest(request.model!, modelConfig.provider, {
              latency,
              statusCode: '200',
              success: true,
            });
            this.updateRankingsFromRealLatency();
            onComplete?.();
          },
          (error) => {
            const latency = Math.round(performance.now() - startTime);
            const msg = error.message;
            let statusCode = 'ERR';
            if (msg.includes('401') || msg.includes('403')) { statusCode = '401'; }
            else if (msg.includes('429')) { statusCode = '429'; }
            else if (msg.includes('404')) { statusCode = '404'; }
            else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) { statusCode = '000'; }
            healthTracker.recordRequest(request.model!, modelConfig.provider, { latency, statusCode, success: false });

            // NO FALLBACK - just report error
            console.error(`❌ Streaming failed for ${request.model}: ${msg}`);
            onError?.(error);
          }
        );
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Streaming error for ${request.model}: ${msg}`);
        throw error;
      }
    }

    // Auto mode - select best model
    const selectionResult = smartModelSelector.selectForMode(
      mode || 'best',
      streamingModels
    );

    if (!selectionResult) {
      throw new Error('No streaming model available');
    }

    const selected = selectionResult.model;
    const provider = this.providers.get(selected.model.provider);
    if (!provider) {
      throw new Error(`Provider ${selected.model.provider} not initialized`);
    }

    const KAWAII_FACES = [
      '(｡•́︿•̀｡)', '(◔_◔)', '(¬‿¬)', '(•_•)', '(・_・；)',
      '(￣ω￣)', '(⌐■_■)', '(◕‿◕)', '(｡◕‿◕｡)', '(✿◠‿◠)'
    ];
    const randomFace = KAWAII_FACES[Math.floor(Math.random() * KAWAII_FACES.length)];
    const displayPath = `[${selected.model.provider}] ${selected.model.id}`;
    const statusMsg = `\n${randomFace} ${displayPath}\n\n`;

    console.log(`[STREAM] Starting ${displayPath}`);

    onChunk({
      id: `status-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: selected.model.id,
      choices: [{
        index: 0,
        delta: { content: statusMsg },
        finish_reason: null
      }]
    });

    // Execute directly - NO FALLBACK, NO SWITCHING
    const startTime = performance.now();
    await provider.executeStreaming(
      { ...request, model: selected.model.id },
      onChunk,
      () => {
        const latency = Math.round(performance.now() - startTime);
        healthTracker.recordRequest(selected.model.id, selected.model.provider, {
          latency,
          statusCode: '200',
          success: true,
        });
        this.updateRankingsFromRealLatency();
        onComplete?.();
      },
      (error) => {
        const latency = Math.round(performance.now() - startTime);
        const msg = error.message;
        let statusCode = 'ERR';
        if (msg.includes('401') || msg.includes('403')) { statusCode = '401'; }
        else if (msg.includes('429')) { statusCode = '429'; }
        else if (msg.includes('404')) { statusCode = '404'; }
        else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) { statusCode = '000'; }
        healthTracker.recordRequest(selected.model.id, selected.model.provider, { latency, statusCode, success: false });

        // NO FALLBACK - just report error
        console.error(`❌ Streaming failed for ${selected.model.id}: ${msg}`);
        onError?.(error);
      }
    );
  }

  getAvailableModels(): ModelConfig[] {
    return this.allModels;
  }

  getRankedModels(): RankedModel[] {
    return this.rankedModels;
  }

  getProvider(providerId: ProviderId): import('./types.js').ProviderConfig | undefined {
    return this.config.providers.find(p => p.id === providerId);
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

  updateConfig(updates: Partial<ProxyConfig>): void {
    this.config = { ...this.config, ...updates };
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
