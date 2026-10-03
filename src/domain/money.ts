import Decimal from 'decimal.js';

type Args = {
  value: Decimal;
  currency: string;
};

export class Money {
  private readonly value: Decimal;
  public readonly currency: string;

  constructor(readonly args: Args) {
    this.value = args.value;
    this.currency = args.currency;
  }

  static zero(currency: string): Money {
    return new Money({ value: new Decimal(0), currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money({
      value: this.value.add(other.value),
      currency: this.currency,
    });
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money({
      value: this.value.sub(other.value),
      currency: this.currency,
    });
  }

  negate(): Money {
    return new Money({
      value: this.value.negated(),
      currency: this.currency,
    });
  }

  get isZero(): boolean {
    return this.value.equals(0);
  }
  get isPositive(): boolean {
    return this.value.greaterThan(0);
  }
  get isNegative(): boolean {
    return !this.isPositive;
  }
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }
  equals(other: Money): boolean {
    return this.value.equals(other.value) && this.currency === other.currency;
  }

  toString(): string {
    return `${this.value.toSignificantDigits(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency === other.currency) return;
    throw new Error(
      `currency not the same: expected ${this.currency}, got ${other.currency}`,
    );
  }
}
