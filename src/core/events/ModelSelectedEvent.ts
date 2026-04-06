import { DomainEvent } from './DomainEvent';

export class ModelSelectedEvent extends DomainEvent {
  constructor(
    readonly modelId: string,
    readonly score: number,
    readonly reason: string,
    readonly fallbackChain: string[]
  ) {
    super('model:selected');
  }
}
