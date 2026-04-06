export class IterationCount {
  private constructor(
    private readonly _current: number,
    private readonly _max: number
  ) {
    if (_current < 0) throw new Error('Current iteration cannot be negative');
    if (_max < 1) throw new Error('Max iterations must be at least 1');
  }

  static create(maxIterations: number): IterationCount {
    return new IterationCount(0, maxIterations);
  }

  increment(): IterationCount {
    return new IterationCount(this._current + 1, this._max);
  }

  get current(): number {
    return this._current;
  }

  get max(): number {
    return this._max;
  }

  get canContinue(): boolean {
    return this._current < this._max;
  }

  get isAtLimit(): boolean {
    return this._current >= this._max;
  }
}
