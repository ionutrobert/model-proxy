import { ModelId } from '../value-objects/ModelId';

export class SelectionResult {
  private constructor(
    private readonly _selectedModel: ModelId,
    private readonly _fallbackChain: ModelId[],
    private readonly _score: number,
    private readonly _reason: string
  ) {}

  static create(params: {
    selectedModel: ModelId;
    fallbackChain: ModelId[];
    score: number;
    reason: string;
  }): SelectionResult {
    return new SelectionResult(
      params.selectedModel,
      params.fallbackChain,
      params.score,
      params.reason
    );
  }

  get selectedModel(): ModelId {
    return this._selectedModel;
  }

  get fallbackChain(): ModelId[] {
    return [...this._fallbackChain];
  }

  get score(): number {
    return this._score;
  }

  get reason(): string {
    return this._reason;
  }
}
