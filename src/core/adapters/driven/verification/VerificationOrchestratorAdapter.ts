import type { IVerificationOrchestrator, VerificationEvent } from '../../../ports/driven/IVerificationOrchestrator';
import type { VerificationContext } from '../../../domain/entities/VerificationContext';

export class VerificationOrchestratorAdapter implements IVerificationOrchestrator {
  private maxIterations: number;
  private timeoutMs: number;
  private completionMarker: string;
  private triggerPhrase: string;

  constructor(config?: {
    maxIterations?: number;
    timeoutMs?: number;
    completionMarker?: string;
    triggerPhrase?: string;
  }) {
    this.maxIterations = config?.maxIterations ?? 5;
    this.timeoutMs = config?.timeoutMs ?? 300000;
    this.completionMarker = config?.completionMarker ?? '[TASK_DONE]';
    this.triggerPhrase = config?.triggerPhrase ?? '#loop';
  }

  async* execute(context: VerificationContext): AsyncGenerator<VerificationEvent> {
    const messages = context.messages;
    let iteration = 0;
    const startTime = Date.now();

    while (iteration < this.maxIterations && context.canContinue) {
      if (Date.now() - startTime > this.timeoutMs) {
        yield {
          type: 'error',
          iteration,
          content: `Timeout (${this.timeoutMs}ms) reached`,
          done: true,
        };
        return;
      }

      iteration++;

      yield {
        type: 'iteration',
        iteration,
        content: `Starting iteration ${iteration}/${this.maxIterations}`,
        done: false,
      };

      await new Promise(resolve => setTimeout(resolve, 100));

      const lastContent = messages[messages.length - 1]?.content || '';
      
      if (this.isComplete(lastContent)) {
        yield {
          type: 'complete',
          iteration,
          content: lastContent.replace(/\[TASK_DONE\]/g, '').trim(),
          done: true,
        };
        return;
      }

      yield {
        type: 'iteration',
        iteration,
        content: lastContent,
        done: false,
      };
    }

    yield {
      type: 'complete',
      iteration: this.maxIterations,
      content: 'Max iterations reached',
      done: true,
    };
  }

  shouldEnableLoop(messages: unknown[]): boolean {
    const msgs = messages as Array<{ role: string; content: string }>;
    const lastUserMessage = [...msgs].reverse().find(m => m.role === 'user');
    
    if (!lastUserMessage || typeof lastUserMessage.content !== 'string') {
      return false;
    }

    return lastUserMessage.content.includes(this.triggerPhrase);
  }

  private isComplete(content: string): boolean {
    return content.includes(this.completionMarker);
  }
}
