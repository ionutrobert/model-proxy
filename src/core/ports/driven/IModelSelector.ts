import type { SelectionCriteria } from '../../domain/value-objects/SelectionCriteria';
import type { SelectionResult } from '../../domain/entities/SelectionResult';

export interface IModelSelector {
  selectBest(criteria: SelectionCriteria): Promise<SelectionResult>;
  getFallbackChain(criteria: SelectionCriteria, exclude: string[]): Promise<string[]>;
}
