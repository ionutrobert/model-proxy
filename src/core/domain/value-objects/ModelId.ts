export class ModelId {
  private constructor(private readonly _value: string) {
    if (!_value || _value.trim().length === 0) {
      throw new Error('ModelId cannot be empty');
    }
  }

  static fromString(id: string): ModelId {
    return new ModelId(id);
  }

  get value(): string {
    return this._value;
  }

  equals(other: ModelId): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
