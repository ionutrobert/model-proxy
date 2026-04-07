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

// Verification Orchestrator
export {
  VerificationOrchestrator,
  DEFAULT_LOOP_CONFIG,
} from './verification-orchestrator.js';

export {
  injectVerificationPrompt,
  removeTriggerPhrase,
} from './prompt-injector.js';

export {
  detectCompletion,
  extractContentBeforeMarker,
} from './completion-detector.js';

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
import { VerificationOrchestrator } from './verification-orchestrator.js';
import { injectVerificationPrompt } from './prompt-injector.js';

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

    // Check for #loop trigger to enable verification
    const orchestrator = new VerificationOrchestrator();
    if (orchestrator.shouldEnableLoop(request.messages)) {
      console.log('🔁 Verification loop enabled (#loop detected)');
      return orchestrator.executeWithVerification(
        request,
        async (req) => {
          // Use fallback chain for execution
          const fallbackChain = smartModelSelector.getFallbackChain(this.rankedModels, 3);
          return this.executeWithFallback(req, fallbackChain);
        }
      );
    }

// Direct model execution when specific model is requested
  const useAutoSelection = options?.useAutoSelection !== false;
  if (!useAutoSelection && request.model) {
    const modelId = request.model;
    console.log(`\n🎯 Direct execution for model: ${modelId}`);

    const modelConfig = this.allModels.find(m => m.id === modelId);
    
    // If model not found, fall back to auto selection instead of erroring
    if (!modelConfig) {
      console.warn(`⚠️ Model ${modelId} not found, falling back to auto selection`);
      // Fall through to auto selection logic below
    } else {
      const provider = this.providers.get(modelConfig.provider);
      if (!provider) {
        console.warn(`⚠️ Provider ${modelConfig.provider} not initialized, falling back to auto selection`);
        // Fall through to auto selection logic below
      } else {
        const startTime = performance.now();
        try {
          const response = await provider.execute({ ...request, model: modelId });
          const latency = Math.round(performance.now() - startTime);

          // Check for empty content - content can be string, array, or null
          // But if tool_calls are present, that's valid too
	const content = response.choices?.[0]?.message?.content;
	const toolCalls = response.choices?.[0]?.message?.tool_calls;
	const contentStr = typeof content === 'string' ? content : Array.isArray(content) ? JSON.stringify(content) : '';
	const hasEmptyContent = contentStr.trim().length === 0 && (!toolCalls || toolCalls.length === 0);

	const isTruncated = (() => {
		if (!contentStr || contentStr.length < 50) return false;
		const trimmed = contentStr.trim();
		const lastChars = trimmed.slice(-50);
		const lastLine = trimmed.split('\n').pop() || '';
		const unclosedCodeBlocks = (trimmed.match(/```/g) || []).length % 2 !== 0;
		const unclosedBrackets = /[{(\[]\s*$/.test(lastLine) || /[{(\[][^})\]]*$/.test(lastChars);
		const endsMidWord = /[a-zA-Z0-9]$/.test(trimmed) && !/[.!?。！？]$/.test(trimmed);
		const endsMidSentence = !/[.!?。！？\n]\s*$/.test(trimmed) && trimmed.length > 200;
		return unclosedCodeBlocks || unclosedBrackets || (endsMidWord && endsMidSentence);
	})();

	if (isTruncated) {
		console.warn(`⚠️ Model ${modelId} returned truncated content, trying fallback`);
		healthTracker.recordRequest(modelId, modelConfig.provider, {
			latency,
			statusCode: '200',
			success: false,
		});
		const fallbackChain = smartModelSelector.getFallbackChain(this.rankedModels, 3);
		return this.executeWithFallback(request, fallbackChain);
	}

	if (hasEmptyContent) {
            console.warn(`⚠️ Model ${modelId} returned empty content, trying fallback`);
            healthTracker.recordRequest(modelId, modelConfig.provider, {
              latency,
              statusCode: '200',
              success: false,
            });
            const fallbackChain = smartModelSelector.getFallbackChain(this.rankedModels, 3);
            return this.executeWithFallback(request, fallbackChain);
          }

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
          
          // On error, try fallback chain instead of throwing
          console.warn(`⚠️ Model ${modelId} failed: ${msg}, trying fallback chain`);
          const fallbackChain = smartModelSelector.getFallbackChain(this.rankedModels, 3);
          return this.executeWithFallback(request, fallbackChain);
        }
      }
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
  // Check for #loop trigger to enable verification
  const orchestrator = new VerificationOrchestrator();
  if (orchestrator.shouldEnableLoop(request.messages)) {
    console.log('🔁 Verification loop enabled for streaming (#loop detected)');
    await this.executeStreamingWithVerification(
      request,
      onChunk,
      onComplete,
      onError,
      mode
    );
    return;
  }

  // Delegate to the base streaming method which handles model switching with content preservation
  await this.executeStreamingBase(request, onChunk, onComplete, onError, mode);
}

/**
   * Execute streaming with verification loop
   * Collects full response, checks for completion, and loops if needed
   */
  private async executeStreamingWithVerification(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
    onComplete?: () => void,
    onError?: (error: Error) => void,
    mode?: SelectionMode
  ): Promise<void> {
    const orchestrator = new VerificationOrchestrator();
    const sanitizedMessages = orchestrator.sanitizeMessages(request.messages);
    const messages = injectVerificationPrompt(sanitizedMessages);

    let iteration = 0;
    const completionMarker = '[TASK_DONE]';
    const maxIterations = 5;
    const timeoutMs = 300000;
    const startTime = Date.now();

    while (iteration < maxIterations) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(`[LOOP] Timeout (${timeoutMs}ms) reached at iteration ${iteration}`);
        break;
      }

    iteration++;

    // Collect streamed content
    let fullContent = '';
    let fullContentClean = ''; // Track clean content without status messages
    let streamError: Error | null = null;

    try {
      console.log(`[LOOP] Iteration ${iteration} - streaming...`);

      await new Promise<void>((resolve, reject) => {
        this.executeStreamingBase(
          { ...request, messages },
          (chunk) => {
            const content = chunk.choices[0]?.delta?.content;
            if (typeof content === 'string') {
              // Filter out status/switch notifications from content accumulation
              if (!content.includes('Model:') &&
                  !content.includes('Switching to') &&
                  !content.includes('⚠️') &&
                  !content.includes('🔄') &&
                  !content.includes('📝 Preserving') &&
                  !content.match(/\(｡•́︿•̀｡\)|\(◔_◔\)|\(¬‿¬\)|\(•_•\)|\(・_・；\)|\(￣ω￣\)|\(⌐■_■\)|\(◕‿◕\)|\(｡◕‿◕｡\)|\(✿◠‿◠\)/)) {
                fullContent += content;
                fullContentClean += content;
              }
              onChunk(chunk);
            }
          },
          () => resolve(),
          (error) => {
            streamError = error;
            reject(error);
          },
          mode
        );
      });

      // Check for completion marker
      if (fullContentClean.includes(completionMarker)) {
        console.log(`[LOOP] Task completed at iteration ${iteration}`);
        onComplete?.();
        return;
      }

      // Generate smart feedback
      const feedback = this.generateSmartFeedback(fullContentClean, iteration);
      console.log(`[LOOP] Iteration ${iteration} incomplete - continuing...`);

      // Send feedback to user
      onChunk({
        id: `loop-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'unknown',
        choices: [{
          index: 0,
          delta: {
            content: `\n\n[Verification: Iteration ${iteration} - continuing...]\n\n`
          },
          finish_reason: null
        }]
      });

      // Add feedback for next iteration using clean content
      messages.push(
        { role: 'assistant', content: fullContentClean },
        { role: 'user', content: feedback }
      );

      // Delay before next iteration
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[LOOP] Iteration ${iteration} error:`, errorMsg);

      // If we have partial clean content, save it and retry with different model
      if (fullContentClean && fullContentClean.length > 10) {
        messages.push(
          { role: 'assistant', content: fullContentClean },
          { role: 'user', content: `You were interrupted. Continue from where you stopped. Add ${completionMarker} when finished.` }
        );

        onChunk({
          id: `loop-error-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: request.model || 'unknown',
          choices: [{
            index: 0,
            delta: {
              content: `\n\n[Model error detected. Switching model and continuing iteration ${iteration}...]\n\n`
            },
            finish_reason: null
          }]
        });

        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // No partial content - just retry
      onChunk({
        id: `loop-error-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: request.model || 'unknown',
        choices: [{
          index: 0,
          delta: {
            content: `\n\n[Model error. Retrying iteration ${iteration} with different model...]\n\n`
          },
          finish_reason: null
        }]
      });

      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    }
  }

  private generateSmartFeedback(content: string, iteration: number): string {
    const marker = '[TASK_DONE]';
    const trimmed = content.trim();
    
    if (trimmed.endsWith('...') || /\w\s*$/.test(trimmed)) {
      return `You stopped mid-sentence. Continue from where you left off. Add ${marker} when finished.`;
    }

    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      return `Your code has unclosed braces. Complete your code block and add ${marker}.`;
    }

    const openParens = (trimmed.match(/\(/g) || []).length;
    const closeParens = (trimmed.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      return `Your code has unclosed parentheses. Complete your code and add ${marker}.`;
    }

    if (/<[a-zA-Z][^>]*$/.test(trimmed)) {
      return `Your HTML/XML is incomplete. Close your tags and add ${marker}.`;
    }

    if (/```[a-z]*$/im.test(trimmed) && !/```[\s\S]*```/m.test(trimmed)) {
      return `Your code block is incomplete. Finish your code, close with \`\`\`, and add ${marker}.`;
    }

    if (iteration <= 3) {
      return `Continue your work. When complete, add ${marker} at the end.`;
    }

    return `Iteration ${iteration}. Please finish and add ${marker}.`;
  }

/**
* Base streaming execution without verification
* Includes automatic model switching on errors with partial content preservation
*/
private async executeStreamingBase(
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

  const fallbackChain = smartModelSelector.getFallbackChain(streamingModels, 5);
  const triedModels: Set<string> = new Set();
  let accumulatedContent = '';
  let accumulatedContentClean = ''; // Clean content without status/switch messages
  let lastModelName = '';
  let isFirstModel = true;

  const KAWAII_FACES = [
    '(｡•́︿•̀｡)', '(◔_◔)', '(¬‿¬)', '(•_•)', '(・_・；)',
    '(￣ω￣)', '(⌐■_■)', '(◕‿◕)', '(｡◕‿◕｡)', '(✿◠‿◠)'
  ];

  // Patterns to filter out from content accumulation
  const STATUS_PATTERNS = [
    /\(｡•́︿•̀｡\)/, /\(◔_◔\)/, /\(¬‿¬\)/, /\(•_•\)/, /\(・_・；\)/,
    /\(￣ω￣\)/, /\(⌐■_■\)/, /\(◕‿◕\)/, /\(｡◕‿◕｡\)/, /\(✿◠‿◠\)/,
    /\[nvidia-nim\]/, /\[openrouter\]/, /\[groq\]/,
    /Fallback:/,
    /⚠️/, /🔄/, /📝/,
    /Switching to/, /Model:/, /Preserving/,
  ];

  const isStatusMessage = (content: string): boolean => {
    return STATUS_PATTERNS.some(pattern => pattern.test(content));
  };

	const isContentTruncated = (content: string, modelName: string): boolean => {
		if (!content || content.length < 100) return false;
		const trimmed = content.trim();

		// Check for unclosed code blocks (strongest signal)
		const codeBlockMatches = trimmed.match(/```/g) || [];
		const unclosedCodeBlocks = codeBlockMatches.length % 2 !== 0;
		if (unclosedCodeBlocks) {
			console.log(`[TRUNCATE] Unclosed code block detected for ${modelName}`);
			return true;
		}

		// Check for unclosed brackets at very end (strong signal)
		const lastLine = trimmed.split('\n').pop() || '';
		if (/[{(\[]\s*$/.test(lastLine)) {
			console.log(`[TRUNCATE] Unclosed bracket at end for ${modelName}`);
			return true;
		}

		// Kimi-specific: detect mid-sentence endings (they have known issues)
		const kimiPattern = /kimi/i.test(modelName || '');
		if (kimiPattern) {
			const lastChars = trimmed.slice(-30);
			// More specific: ends without punctuation AND has recent incomplete structure
			const endsAbruptly = !/[.!?。！？"`']\s*$/.test(trimmed);
			const hasRecentColon = /[:\->]\s*$/.test(lastChars);
			if (endsAbruptly && trimmed.length > 500) {
				console.log(`[KIMI-DETECT] Possible truncation for ${modelName}`);
				return true;
			}
		}

		return false;
	};

	for (const rankedModel of fallbackChain) {
		if (triedModels.has(rankedModel.model.id)) continue;
		triedModels.add(rankedModel.model.id);

    const provider = this.providers.get(rankedModel.model.provider);
    if (!provider) continue;

    const streamStartTime = performance.now();
    let streamSuccess = false;
    let chunkCount = 0;
    let modelPartialContent = '';
    let modelPartialContentClean = ''; // Clean content for this model only

    const fullModelPath = rankedModel.model.id;
    const providerName = rankedModel.model.provider;
    const modelChanged = lastModelName && lastModelName !== fullModelPath;

    if (isFirstModel || modelChanged) {
      const randomFace = KAWAII_FACES[Math.floor(Math.random() * KAWAII_FACES.length)];
      const displayPath = `[${providerName}] ${fullModelPath}`;
      const statusMsg = isFirstModel
        ? `\n${randomFace} ${displayPath}\n\n`
        : `\n${randomFace} Fallback: ${displayPath}\n\n`;

      // Send status as a special metadata chunk, not as content
      // This prevents status messages from accumulating in content
      console.log(`[STREAM] ${isFirstModel ? 'Starting' : 'Switching to'} ${displayPath}`);

      // Still send the status message for user visibility, but mark it clearly
      onChunk({
        id: `status-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: fullModelPath,
        choices: [{
          index: 0,
          delta: { content: statusMsg },
          finish_reason: null
        }]
      });
    }

    lastModelName = fullModelPath;
    isFirstModel = false;

    // Build request - only inject clean accumulated content, not status messages
    let modelRequest = { ...request, model: rankedModel.model.id };
    if (accumulatedContentClean.length > 0) {
      // Use only clean content for continuation
      const continuationPrompt = `[Previous model stopped. Continue from where it stopped. Last output (last 1500 chars):\n---\n${accumulatedContentClean.slice(-1500)}\n---\nContinue exactly from where it stopped, maintaining the same format and style. Do NOT repeat the content above.]`;
      modelRequest = {
        ...modelRequest,
        messages: [
          ...request.messages,
          { role: 'assistant', content: accumulatedContentClean },
          { role: 'user', content: continuationPrompt }
        ]
      };
    }

    try {
      await provider.executeStreaming(
        modelRequest,
        (chunk) => {
          chunkCount++;
          const content = chunk.choices[0]?.delta?.content;
          if (typeof content === 'string') {
            modelPartialContent += content;
            accumulatedContent += content;
            
            // Only accumulate clean content (filter out status messages)
            if (!isStatusMessage(content)) {
              modelPartialContentClean += content;
              accumulatedContentClean += content;
            }
          }
          onChunk(chunk);
        },
	() => {
		const latency = Math.round(performance.now() - streamStartTime);
		const hasContent = modelPartialContent.trim().length > 0;
		const isTruncated = isContentTruncated(modelPartialContent, rankedModel.model.name);

		if (isTruncated) {
			console.warn(`⚠️ ${rankedModel.model.name} returned truncated content - triggering fallback`);
			streamSuccess = false;
			healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
				latency,
				statusCode: '200',
				success: false,
			});
			circuitBreaker.recordFailure(rankedModel.model.provider, 'Truncated content detected');
			return;
		}

		streamSuccess = true;
		if (!hasContent) {
			console.warn(`⚠️ ${rankedModel.model.name} streaming returned empty content`);
		}
      healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
        latency,
        statusCode: '200',
        success: hasContent,
      });
      this.updateRankingsFromRealLatency();
      if (hasContent) {
			circuitBreaker.recordSuccess(rankedModel.model.provider);
		} else {
			circuitBreaker.recordFailure(rankedModel.model.provider, 'Empty content in streaming');
		}
		onComplete?.();
	},
        (error) => {
          const latency = Math.round(performance.now() - streamStartTime);
          streamSuccess = false;
          let statusCode = 'ERR';
          const msg = error.message;
          if (msg.includes('401') || msg.includes('403')) { statusCode = '401'; }
          else if (msg.includes('429')) { statusCode = '429'; }
          else if (msg.includes('404')) { statusCode = '404'; }
          else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('Stream timeout')) { statusCode = '000'; }
          healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, { latency, statusCode, success: false });
          circuitBreaker.recordFailure(rankedModel.model.provider, msg);

          const nextModel = fallbackChain[fallbackChain.indexOf(rankedModel) + 1];
          if (nextModel) {
            const switchMsg = `\n\n⚠️ [${providerName}] ${fullModelPath} encountered an error. Switching to ${nextModel.model.id}...\n` +
              (modelPartialContentClean.length > 0 ? `📝 Preserving ${modelPartialContentClean.length} chars of content.\n` : '') +
              `🔄 Continuing...\n\n`;
            
            console.log(`[MODEL-SWITCH] ${fullModelPath} → ${nextModel.model.id} (preserved ${modelPartialContentClean.length} clean chars)`);
            
            onChunk({
              id: `switch-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: fullModelPath,
              choices: [{
                index: 0,
                delta: { content: switchMsg },
                finish_reason: null
              }]
            });
          } else if (fallbackChain.indexOf(rankedModel) === fallbackChain.length - 1) {
            onError?.(error);
          }
        }
      );

      if (streamSuccess) {
        return;
      }

      const streamDuration = performance.now() - streamStartTime;
      if (chunkCount > 0 && !streamSuccess && streamDuration > 5000) {
        console.log(`[MODEL-SWITCH] ${rankedModel.model.name} stopped unexpectedly after ${chunkCount} chunks`);

        healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
          latency: Math.round(streamDuration),
          statusCode: 'ERR',
          success: false,
        });
        circuitBreaker.recordFailure(rankedModel.model.provider, 'Stream stopped unexpectedly');

        const nextModel = fallbackChain[fallbackChain.indexOf(rankedModel) + 1];
        if (nextModel) {
          const switchMsg = `\n\n⚠️ Stream from [${providerName}] ${fullModelPath} stopped unexpectedly. Switching to ${nextModel.model.id}...\n` +
            (modelPartialContentClean.length > 0 ? `📝 Preserving ${modelPartialContentClean.length} chars.\n` : '') +
            `🔄 Continuing...\n\n`;
          
          onChunk({
            id: `switch-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: fullModelPath,
            choices: [{
              index: 0,
              delta: { content: switchMsg },
              finish_reason: null
            }]
          });
        }
		continue;
      }
    } catch (error) {
      const latency = Math.round(performance.now() - streamStartTime);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Stream error from ${rankedModel.model.name}: ${errorMessage}`);

      let statusCode = 'ERR';
      if (errorMessage.includes('401') || errorMessage.includes('403')) { statusCode = '401'; }
      else if (errorMessage.includes('429')) { statusCode = '429'; }
      else if (errorMessage.includes('404')) { statusCode = '404'; }
      else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) { statusCode = '000'; }

      healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, { latency, statusCode, success: false });
      circuitBreaker.recordFailure(rankedModel.model.provider, errorMessage);

      const nextModel = fallbackChain[fallbackChain.indexOf(rankedModel) + 1];
      if (nextModel) {
        const switchMsg = `\n\n⚠️ Model [${providerName}] ${fullModelPath} crashed: ${errorMessage.slice(0, 100)}. Switching to ${nextModel.model.id}...\n` +
          (modelPartialContentClean.length > 0 ? `📝 Preserving ${modelPartialContentClean.length} chars of content.\n` : '') +
          `🔄 Continuing...\n\n`;
        
        onChunk({
          id: `switch-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: fullModelPath,
          choices: [{
            index: 0,
            delta: { content: switchMsg },
            finish_reason: null
          }]
        });
      }
	continue;
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

      // Check for empty content - content can be string, array, or null
      // But if tool_calls are present, that's valid too
      const content = response.choices?.[0]?.message?.content;
      const toolCalls = response.choices?.[0]?.message?.tool_calls;
      const contentStr = typeof content === 'string' ? content : Array.isArray(content) ? JSON.stringify(content) : '';
      const hasEmptyContent = contentStr.trim().length === 0 && (!toolCalls || toolCalls.length === 0);

      if (hasEmptyContent) {
        console.warn(`⚠️ ${rankedModel.model.name} returned empty content, treating as failure`);
        healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
          latency,
          statusCode: '200',
          success: false,
        });
        circuitBreaker.recordFailure(rankedModel.model.provider, 'Empty content response');
        errors.push(`${rankedModel.model.name}: Empty content`);
        continue; // Try next model in fallback chain
      }

      circuitBreaker.recordSuccess(rankedModel.model.provider);
      healthTracker.recordRequest(rankedModel.model.id, rankedModel.model.provider, {
        latency,
        statusCode: '200',
        success: true,
      });
      this.updateRankingsFromRealLatency();
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
