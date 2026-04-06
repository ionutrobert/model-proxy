import { DomainEvent } from './DomainEvent';
import type { ModelId } from '../domain/value-objects/ModelId';

export class HealthChangedEvent extends DomainEvent {
  constructor(
    readonly modelId: ModelId,
    readonly previousScore: number,
    readonly currentScore: number
  ) {
    super('health:changed');
  }
}
