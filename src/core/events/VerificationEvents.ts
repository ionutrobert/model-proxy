import { DomainEvent } from './DomainEvent';

export class VerificationIterationEvent extends DomainEvent {
  constructor(
    readonly iteration: number,
    readonly modelId: string,
    readonly content: string
  ) {
    super('verification:iteration');
  }
}

export class VerificationCompleteEvent extends DomainEvent {
  constructor(
    readonly iterations: number,
    readonly finalModel: string,
    readonly success: boolean
  ) {
    super('verification:complete');
  }
}
