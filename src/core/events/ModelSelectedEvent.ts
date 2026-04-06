import { DomainEvent } from './DomainEvent';
import type { ModelId } from '../domain/value-objects/ModelId';
import type { SelectionCriteria } from '../domain/value-objects/SelectionCriteria';

export class ModelSelectedEvent extends DomainEvent {
  constructor(
    readonly modelId: ModelId,
    readonly score: number,
    readonly criteria: SelectionCriteria
  ) {
    super('model:selected');
  }
}
