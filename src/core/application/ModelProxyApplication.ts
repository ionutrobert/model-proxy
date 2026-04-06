import type { IModelProxy, StreamingEvent } from '../ports/driving/IModelProxy';
import type { IModelSelector } from '../ports/driven/IModelSelector';
import type { IHealthService } from '../ports/driven/IHealthService';
import type { IVerificationOrchestrator } from '../ports/driven/IVerificationOrchestrator';
import type { IEventBus } from '../ports/driven/IEventBus';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from '../types';
import { SelectionCriteria } from '../domain/value-objects/SelectionCriteria';
import { VerificationContext } from '../domain/entities/VerificationContext';
import type { HealthAssessmentDto } from '../DataTransfer/HealthAssessmentDto';

export interface ProviderAdapter {
  id: string;
  execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  executeStreaming(request: ChatCompletionRequest, onChunk: (chunk: ChatCompletionChunk) => void): Promise<void>;
}

export interface ModelProxyConfig {
  providers: ProviderAdapter[];
  defaultMaxIterations?: number;
  defaultTimeoutMs?: number;
}

class ModelExecutedEvent {
  readonly eventId = crypto.randomUUID();
  readonly occurredAt = new Date();
  readonly eventType = 'model:executed';
  constructor(
    readonly data: { modelId: string; latencyMs: number; success: boolean }
  ) {}
}

class ModelErrorEvent {
  readonly eventId = crypto.randomUUID();
  readonly occurredAt = new Date();
  readonly eventType = 'model:error';
  constructor(
    readonly data: { modelId: string; latencyMs: number; error: string }
  ) {}
}

class HealthRefreshedEvent {
  readonly eventId = crypto.randomUUID();
  readonly occurredAt = new Date();
  readonly eventType = 'health:refreshed';
  constructor(
    readonly data: { modelCount: number }
  ) {}
}

export class ModelProxyApplication implements IModelProxy {
  private modelToProvider: Map<string, ProviderAdapter> = new Map();
  private healthCache: Map<string, HealthAssessmentDto> = new Map();

  constructor(
    private readonly modelSelector: IModelSelector,
    private readonly healthService: IHealthService,
    private readonly verificationOrchestrator: IVerificationOrchestrator,
    private readonly eventBus: IEventBus,
    private readonly config: ModelProxyConfig
  ) {
    this.initializeProviderMappings();
  }

  private initializeProviderMappings(): void {
    for (const provider of this.config.providers) {
      this.modelToProvider.set(provider.id, provider);
    }
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const criteria = this.buildSelectionCriteria(request);

    if (this.verificationOrchestrator.shouldEnableLoop(request.messages)) {
      return this.executeWithVerification(request, criteria);
    }

    if (request.model) {
      return this.executeDirect(request, request.model);
    }

    return this.executeWithAutoSelection(request, criteria);
  }

  async *executeStreaming(request: ChatCompletionRequest): AsyncGenerator<StreamingEvent> {
    const criteria = this.buildSelectionCriteria(request);

    if (this.verificationOrchestrator.shouldEnableLoop(request.messages)) {
      yield* this.executeStreamingWithVerification(request, criteria);
      return;
    }

    if (request.model) {
      yield* this.executeStreamingDirect(request, request.model);
      return;
    }

    yield* this.executeStreamingWithAutoSelection(request, criteria);
  }

  async refreshHealth(): Promise<void> {
    await this.healthService.refresh();
    const allHealth = await this.healthService.getAllHealth();
    
    for (const [modelId, health] of allHealth) {
      this.healthCache.set(modelId, health);
    }

    this.eventBus.publish(new HealthRefreshedEvent({ modelCount: allHealth.size }));
  }

  private buildSelectionCriteria(request: ChatCompletionRequest): SelectionCriteria {
    const tools = request.tools;
    return SelectionCriteria.create({
      mode: 'balanced',
      requiresFunctionCalling: tools !== undefined && tools.length > 0,
      minHealthScore: 50
    });
  }

  private async executeDirect(
    request: ChatCompletionRequest,
    modelId: string
  ): Promise<ChatCompletionResponse> {
    const provider = this.modelToProvider.get(modelId);
    
    if (!provider) {
      throw new Error(`No provider found for model: ${modelId}`);
    }

    const startTime = Date.now();
    try {
      const response = await provider.execute({ ...request, model: modelId });
      
      this.eventBus.publish(new ModelExecutedEvent({
        modelId,
        latencyMs: Date.now() - startTime,
        success: true
      }));

      return response;
    } catch (error) {
      this.eventBus.publish(new ModelErrorEvent({
        modelId,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
      throw error;
    }
  }

  private async executeWithAutoSelection(
    request: ChatCompletionRequest,
    criteria: SelectionCriteria
  ): Promise<ChatCompletionResponse> {
    const selectionResult = await this.modelSelector.selectBest(criteria);

    if (!selectionResult.success || !selectionResult.selectedModel) {
      throw new Error(selectionResult.reason);
    }

    const modelId = selectionResult.selectedModel.value;
    const fallbackChain = selectionResult.fallbackChain.map(m => m.value);

    return this.executeWithFallback(request, modelId, fallbackChain);
  }

  private async executeWithFallback(
    request: ChatCompletionRequest,
    primaryModelId: string,
    fallbackChain: string[]
  ): Promise<ChatCompletionResponse> {
    const modelsToTry = [primaryModelId, ...fallbackChain];
    
    for (const modelId of modelsToTry) {
      try {
        return await this.executeDirect(request, modelId);
      } catch (error) {
        console.warn(`Model ${modelId} failed, trying next fallback...`);
        
        if (modelId === modelsToTry[modelsToTry.length - 1]) {
          throw error;
        }
      }
    }

    throw new Error('All models in fallback chain failed');
  }

  private async executeWithVerification(
    request: ChatCompletionRequest,
    criteria: SelectionCriteria
  ): Promise<ChatCompletionResponse> {
    const context = VerificationContext.create({
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : ''
      })),
      maxIterations: this.config.defaultMaxIterations,
      timeoutMs: this.config.defaultTimeoutMs
    });

    let lastContent = '';
    let iteration = 0;

    for await (const event of this.verificationOrchestrator.execute(context)) {
      iteration = event.iteration;

      if (event.type === 'complete' && event.done) {
        return this.buildResponse(request, event.content || lastContent);
      }

      if (event.type === 'iteration' && event.content) {
        lastContent = event.content;
      }

      if (event.type === 'error') {
        throw new Error(event.content || 'Verification failed');
      }
    }

    return this.buildResponse(request, lastContent);
  }

  private async *executeStreamingDirect(
    request: ChatCompletionRequest,
    modelId: string
  ): AsyncGenerator<StreamingEvent> {
    const provider = this.modelToProvider.get(modelId);
    
    if (!provider) {
      yield { type: 'error', data: { message: `No provider for model: ${modelId}` } };
      return;
    }

    yield { type: 'model_switch', data: { modelId } };

    const chunks: ChatCompletionChunk[] = [];

    try {
      await provider.executeStreaming(request, (chunk) => {
        chunks.push(chunk);
      });

      for (const chunk of chunks) {
        yield { type: 'content', data: chunk };
      }

      yield { type: 'done', data: { modelId } };
    } catch (error) {
      yield {
        type: 'error',
        data: { message: error instanceof Error ? error.message : 'Streaming failed' }
      };
    }
  }

  private async *executeStreamingWithAutoSelection(
    request: ChatCompletionRequest,
    criteria: SelectionCriteria
  ): AsyncGenerator<StreamingEvent> {
    const selectionResult = await this.modelSelector.selectBest(criteria);

    if (!selectionResult.success || !selectionResult.selectedModel) {
      yield { type: 'error', data: { message: selectionResult.reason } };
      return;
    }

    const modelId = selectionResult.selectedModel.value;
    yield { type: 'model_switch', data: { modelId } };

    yield* this.executeStreamingDirect(request, modelId);
  }

  private async *executeStreamingWithVerification(
    request: ChatCompletionRequest,
    criteria: SelectionCriteria
  ): AsyncGenerator<StreamingEvent> {
    const context = VerificationContext.create({
      messages: request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : ''
      })),
      maxIterations: this.config.defaultMaxIterations,
      timeoutMs: this.config.defaultTimeoutMs
    });

    let iteration = 0;

    for await (const event of this.verificationOrchestrator.execute(context)) {
      iteration = event.iteration;

      yield {
        type: 'verification',
        data: {
          iteration,
          content: event.content,
          done: event.done
        }
      };

      if (event.type === 'complete' && event.done) {
        yield { type: 'done', data: { iterations: iteration } };
        return;
      }

      if (event.type === 'error') {
        yield { type: 'error', data: { message: event.content } };
        return;
      }
    }
  }

  private buildResponse(request: ChatCompletionRequest, content: string): ChatCompletionResponse {
    return {
      id: `chat-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model || 'auto-selected',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }
}
