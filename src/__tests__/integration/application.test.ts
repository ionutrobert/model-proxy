import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelProxyApplication, type ProviderAdapter } from '../../core/application/ModelProxyApplication.js';
import { SmartModelSelector } from '../../core/adapters/driven/model-selection/SmartModelSelector.js';
import { HealthService } from '../../core/adapters/driven/health/HealthService.js';
import { VerificationOrchestratorAdapter } from '../../core/adapters/driven/verification/VerificationOrchestratorAdapter.js';
import { InMemoryEventBus } from '../../core/adapters/driven/events/InMemoryEventBus.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../core/types.js';
import { CURATED_MODELS } from '../../core/curated-models.js';
import { CompositionRoot } from '../../core/composition-root.js';

describe('Integration: ModelProxyApplication', () => {
  let eventBus: InMemoryEventBus;
  let healthService: HealthService;
  let modelSelector: SmartModelSelector;
  let verificationOrchestrator: VerificationOrchestratorAdapter;
  let application: ModelProxyApplication;
  let mockProvider: ProviderAdapter;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    
    mockProvider = {
      id: 'test-model',
      execute: vi.fn(async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => ({
        id: 'test-response',
        object: 'chat.completion' as const,
        created: Date.now(),
        model: req.model || 'test-model',
        choices: [{
          index: 0,
          message: { role: 'assistant' as const, content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      })),
      executeStreaming: vi.fn()
    };

    healthService = new HealthService(
      { endpoint: 'http://localhost', intervalMs: 60000, timeoutMs: 5000 },
      eventBus
    );

    modelSelector = new SmartModelSelector(healthService, eventBus, CURATED_MODELS);
    
    verificationOrchestrator = new VerificationOrchestratorAdapter({
      maxIterations: 3,
      timeoutMs: 10000,
      completionMarker: '[TASK_DONE]',
      triggerPhrase: '#loop'
    });

    application = new ModelProxyApplication(
      modelSelector,
      healthService,
      verificationOrchestrator,
      eventBus,
      { providers: [mockProvider], defaultMaxIterations: 3, defaultTimeoutMs: 10000 }
    );
  });

  describe('execute', () => {
    it('should execute direct request with specified model', async () => {
      const request: ChatCompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      const response = await application.execute(request);

      expect(response).toBeDefined();
      expect(response.object).toBe('chat.completion');
      expect(response.choices[0].message.role).toBe('assistant');
      expect(mockProvider.execute).toHaveBeenCalled();
    });

    it('should throw error for unknown model', async () => {
      const request: ChatCompletionRequest = {
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      await expect(application.execute(request)).rejects.toThrow('No provider found');
    });
  });

  describe('verification loop', () => {
    it('should trigger verification with #loop', async () => {
      const request: ChatCompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: '#loop Please help me [TASK_DONE]' }]
      };

      const response = await application.execute(request);

      expect(response).toBeDefined();
      expect(response.object).toBe('chat.completion');
    });
  });

  describe('events', () => {
    it('should publish model executed event', async () => {
      const eventHandler = vi.fn();
      eventBus.subscribe('model:executed', eventHandler);

      const request: ChatCompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      };

      await application.execute(request);

      expect(eventHandler).toHaveBeenCalled();
    });
  });
});

describe('Integration: Composition Root', () => {
  it('should wire all components together', async () => {
    const mockProvider: ProviderAdapter = {
      id: 'deepseek-ai/deepseek-v3.2',
      execute: vi.fn(async (): Promise<ChatCompletionResponse> => ({
        id: 'test',
        object: 'chat.completion' as const,
        created: Date.now(),
        model: 'deepseek-ai/deepseek-v3.2',
        choices: [{
          index: 0,
          message: { role: 'assistant' as const, content: 'OK' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
      })),
      executeStreaming: vi.fn()
    };

    const root = new CompositionRoot({
      endpoint: 'http://localhost:8080',
      providers: [mockProvider],
      healthCheckIntervalMs: 60000,
      healthCheckTimeoutMs: 5000,
      verificationMaxIterations: 3,
      verificationTimeoutMs: 10000
    });

    const proxy = root.getModelProxy();
    expect(proxy).toBeDefined();
    expect(typeof proxy.execute).toBe('function');
    expect(typeof proxy.refreshHealth).toBe('function');
  });
});
