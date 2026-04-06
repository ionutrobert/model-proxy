import type { VerificationContext } from '../../domain/entities/VerificationContext';

export interface IVerificationOrchestrator {
  execute(context: VerificationContext): AsyncGenerator<VerificationEvent>;
  shouldEnableLoop(messages: unknown[]): boolean;
}

export interface VerificationEvent {
  type: 'iteration' | 'complete' | 'error';
  iteration: number;
  content?: string;
  done: boolean;
}
