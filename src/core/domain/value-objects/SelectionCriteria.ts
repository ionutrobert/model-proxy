export type SelectionMode = 'auto-coding' | 'auto-fast' | 'balanced' | 'manual';

export class SelectionCriteria {
  private constructor(
    private readonly _mode: SelectionMode,
    private readonly _preferredModel?: string,
    private readonly _excludedModels: string[] = [],
    private readonly _maxFallbacks: number = 3,
    private readonly _minContextWindow?: number,
    private readonly _requiresFunctionCalling: boolean = false,
    private readonly _requiresVision: boolean = false,
    private readonly _minHealthScore: number = 0,
    private readonly _minTier?: string,
    private readonly _preferThinking?: boolean,
    private readonly _preferSpeed: boolean = false
  ) {}

  static create(params: {
    mode?: SelectionMode;
    preferredModel?: string;
    excludedModels?: string[];
    maxFallbacks?: number;
    minContextWindow?: number;
    requiresFunctionCalling?: boolean;
    requiresVision?: boolean;
    minHealthScore?: number;
    minTier?: string;
    preferThinking?: boolean;
    preferSpeed?: boolean;
  }): SelectionCriteria {
    return new SelectionCriteria(
      params.mode || 'balanced',
      params.preferredModel,
      params.excludedModels || [],
      params.maxFallbacks || 3,
      params.minContextWindow,
      params.requiresFunctionCalling ?? false,
      params.requiresVision ?? false,
      params.minHealthScore ?? 0,
      params.minTier,
      params.preferThinking,
      params.preferSpeed ?? false
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

  get minContextWindow(): number | undefined {
    return this._minContextWindow;
  }

  get requiresFunctionCalling(): boolean {
    return this._requiresFunctionCalling;
  }

  get requiresVision(): boolean {
    return this._requiresVision;
  }

  get minHealthScore(): number {
    return this._minHealthScore;
  }

  get minTier(): string | undefined {
    return this._minTier;
  }

  get preferThinking(): boolean | undefined {
    return this._preferThinking;
  }

  get preferSpeed(): boolean {
    return this._preferSpeed;
  }
}
