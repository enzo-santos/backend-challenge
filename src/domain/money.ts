import Decimal from "decimal.js";

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    return new Money(new Decimal(props.amount), props.currency)
  }
  static zero(currency: string): Money {
    return new Money(new Decimal(0), currency)
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.value.add(other.value), this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.value.sub(other.value), this.currency)
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency)
  }

  get isZero(): boolean {
    return this.value.equals(0)
  }
  get isPositive(): boolean {
    return this.value.greaterThan(0)
  }
  get isNegative(): boolean {
    return !this.isPositive
  }
  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other)
    return this.value.lessThan(other.value)
  }
  equals(other: Money): boolean {
    return this.value.equals(other.value) && this.currency === other.currency
  }
  toJSON(): MoneyProps {
    return {amount: this.value.toSignificantDigits(2).toString(), currency: this.currency}
  }
  toString(): string {
    const props = this.toJSON()
    return `${props.amount} ${props.currency}`
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency === other.currency) return
    throw new Error(`currency not the same: expected ${this.currency}, got ${other.currency}`)
  }
}