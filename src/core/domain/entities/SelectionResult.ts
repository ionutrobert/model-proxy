import { ModelId } from '../value-objects/ModelId';

export class SelectionResult {
  private constructor(
    private readonly _selectedModel: ModelId | null,
    private readonly _fallbackChain: ModelId[],
    private readonly _score: number,
    private readonly _reason: string,
    private readonly _success: boolean
  ) {}

  static createSuccess(
    selectedModel: ModelId,
    score: number,
    fallbackIds: string[]
  ): SelectionResult {
    return new SelectionResult(
      selectedModel,
      fallbackIds.map((id: string) => ModelId.fromString(id)),
      score,
      'Model selected successfully',
      true
    );
  }

  static createFailed(reason: string): SelectionResult {
    return new SelectionResult(
      null,
      [],
      0,
      reason,
      false
    );
  }

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
      params.reason,
      true
    );
  }

  get selectedModel(): ModelId | null {
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

  get success(): boolean {
    return this._success;
  }
}
