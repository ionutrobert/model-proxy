export class HealthScore {
  private constructor(private readonly _value: number) {
    if (_value < 0 || _value > 100) {
      throw new Error('HealthScore must be between 0 and 100');
    }
  }

  static fromNumber(score: number): HealthScore {
    return new HealthScore(score);
  }

  get value(): number {
    return this._value;
  }

  get isHealthy(): boolean {
    return this._value >= 70;
  }

  get isDegraded(): boolean {
    return this._value >= 40 && this._value < 70;
  }

  get isUnhealthy(): boolean {
    return this._value < 40;
  }
}
