import Decimal from 'decimal.js';
import { Money } from '@/src/domain/money';

export function moneyFromRow(amount: unknown, currency: unknown): Money {
  return new Money({
    value: new Decimal(String(amount)),
    currency: String(currency),
  });
}

export function optionalDate(value: unknown): Date | undefined {
  return value == null ? undefined : new Date(String(value));
}

export function requiredDate(value: unknown): Date {
  return new Date(String(value));
}
