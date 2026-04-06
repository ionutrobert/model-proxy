import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VerificationOrchestrator } from '../../core/verification-orchestrator';
import { ChatCompletionRequest, ChatCompletionResponse } from '../../core/types';

describe('Bug: Infinite Loop in Verification', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should enforce maxIterations limit (not infinite)', async () => {
    let callCount = 0;

    const mockExecutor = async (): Promise<ChatCompletionResponse> => {
      callCount++;
      return {
        id: `test-${callCount}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: `Response ${callCount}`,
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };

    const orchestrator = new VerificationOrchestrator({
      maxIterations: 0,
      retryDelayMs: 0,
    });

    const request: ChatCompletionRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: '#loop test' }],
    };

    await orchestrator.executeWithVerification(request, mockExecutor);

    expect(callCount).toBeLessThanOrEqual(6);
    expect(callCount).toBeGreaterThan(0);
  }, 10000);

  it('should enforce timeout limit', async () => {
    let callCount = 0;

    const mockExecutor = async (): Promise<ChatCompletionResponse> => {
      callCount++;
      await new Promise(r => setTimeout(r, 200));
      return {
        id: `test-${callCount}`,
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'slow response',
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
    };

    const orchestrator = new VerificationOrchestrator({
      maxIterations: 100,
      timeoutMs: 500,
      retryDelayMs: 0,
    });

    const request: ChatCompletionRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: '#loop test' }],
    };

    const start = Date.now();

    try {
      await orchestrator.executeWithVerification(request, mockExecutor);
    } catch (error) {
      // Expected timeout error
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);
    expect(callCount).toBeLessThan(10);
  }, 10000);
});
