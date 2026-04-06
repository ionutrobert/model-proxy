import { IterationCount } from '../value-objects/IterationCount';

export interface MessageLike {
  role: string;
  content: string;
}

export class VerificationContext {
  private constructor(
    private readonly _messages: MessageLike[],
    private readonly _systemPrompt: string,
    private readonly _iterations: IterationCount,
    private readonly _startTime: number,
    private readonly _timeoutMs: number
  ) {}

  static create(params: {
    messages: MessageLike[];
    systemPrompt?: string;
    maxIterations?: number;
    timeoutMs?: number;
  }): VerificationContext {
    const max = params.maxIterations || 5;
    return new VerificationContext(
      params.messages,
      params.systemPrompt || '',
      IterationCount.create(max),
      Date.now(),
      params.timeoutMs || 300000
    );
  }

  get messages(): MessageLike[] {
    return [...this._messages];
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  get iterations(): IterationCount {
    return this._iterations;
  }

  get elapsedMs(): number {
    return Date.now() - this._startTime;
  }

  get remainingTimeMs(): number {
    return Math.max(0, this._timeoutMs - this.elapsedMs);
  }

  get canContinue(): boolean {
    return this._iterations.canContinue && this.remainingTimeMs > 0;
  }

  withIncrementedIteration(): VerificationContext {
    return new VerificationContext(
      this._messages,
      this._systemPrompt,
      this._iterations.increment(),
      this._startTime,
      this._timeoutMs
    );
  }

  withMessages(messages: MessageLike[]): VerificationContext {
    return new VerificationContext(
      messages,
      this._systemPrompt,
      this._iterations,
      this._startTime,
      this._timeoutMs
    );
  }
}
