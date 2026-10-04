import { Money } from './money';

type Args = {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  createdAt: Date;
  version?: number;
  updatedAt?: Date;
};

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  public readonly balance: Money;
  public readonly createdAt: Date;
  public readonly version: number;
  public readonly updatedAt: Date;

  constructor(args: Args) {
    if (args.balance.currency !== args.currency) {
      throw new Error(
        `wallet currency does not match balance: expected ${args.currency}, got ${args.balance.currency}`,
      );
    }
    if (args.balance.isNegative) {
      throw new Error('wallet balance cannot be negative');
    }

    const version = args.version ?? 1;
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('wallet version must be a positive integer');
    }

    this.id = args.id;
    this.playerId = args.playerId;
    this.currency = args.currency;
    this.balance = args.balance;
    this.createdAt = args.createdAt;
    this.version = version;
    this.updatedAt = args.updatedAt ?? args.createdAt;
  }

  withCredit(amount: Money, at: Date = new Date()): Wallet {
    if (!amount.isPositive) {
      throw new Error('wallet credit amount must be positive');
    }
    if (amount.currency !== this.currency) {
      throw new Error(
        `wallet currency does not match amount: expected ${this.currency}, got ${amount.currency}`,
      );
    }

    return new Wallet({
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: this.balance.add(amount),
      createdAt: this.createdAt,
      version: this.version + 1,
      updatedAt: at,
    });
  }

  withDebit(amount: Money, at: Date = new Date()): Wallet {
    if (!amount.isPositive) {
      throw new Error('wallet debit amount must be positive');
    }
    if (amount.currency !== this.currency) {
      throw new Error(
        `wallet currency does not match amount: expected ${this.currency}, got ${amount.currency}`,
      );
    }

    const balance = this.balance.subtract(amount);
    if (balance.isNegative) {
      throw new Error('wallet balance cannot be negative');
    }

    return new Wallet({
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance,
      createdAt: this.createdAt,
      version: this.version + 1,
      updatedAt: at,
    });
  }
}
