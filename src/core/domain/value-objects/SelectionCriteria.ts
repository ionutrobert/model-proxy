export type SelectionMode = 'auto-coding' | 'auto-fast' | 'balanced' | 'manual';

export class SelectionCriteria {
  private constructor(
    private readonly _mode: SelectionMode,
    private readonly _preferredModel?: string,
    private readonly _excludedModels: string[] = [],
    private readonly _maxFallbacks: number = 3
  ) {}

  static create(params: {
    mode?: SelectionMode;
    preferredModel?: string;
    excludedModels?: string[];
    maxFallbacks?: number;
  }): SelectionCriteria {
    return new SelectionCriteria(
      params.mode || 'balanced',
      params.preferredModel,
      params.excludedModels || [],
      params.maxFallbacks || 3
    );
  }

  get mode(): SelectionMode {
    return this._mode;
  }

  get preferredModel(): string | undefined {
    return this._preferredModel;
  }

  get excludedModels(): string[] {
    return [...this._excludedModels];
  }

  get maxFallbacks(): number {
    return this._maxFallbacks;
  }
}
