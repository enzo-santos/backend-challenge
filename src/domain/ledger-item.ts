import { Money } from './money';

function isBalanced(args: {
  type: LedgerItemType;
  balanceBefore: Money;
  amount: Money;
  balanceAfter: Money;
}): boolean {
  const expectedBalanceAfter =
    args.type === LedgerItemType.Credit
      ? args.balanceBefore.add(args.amount)
      : args.type === LedgerItemType.Debit
        ? args.balanceBefore.subtract(args.amount)
        : undefined;

  return expectedBalanceAfter?.equals(args.balanceAfter) ?? false;
}

export enum LedgerItemType {
  Credit = 'CREDIT',
  Debit = 'DEBIT',
}

type Args = {
  id: string;
  transactionId: string;
  walletId: string;
  type: LedgerItemType;
  balanceBefore: Money;
  amount: Money;
  balanceAfter: Money;
  createdAt: Date;
};

export class LedgerItem {
  // Chaves primárias e estrangeiras
  public readonly id: string;
  public readonly transactionId: string;
  public readonly walletId: string;

  public readonly type: LedgerItemType;

  // Dados financeiros
  public readonly balanceBefore: Money;
  public readonly amount: Money;
  public readonly balanceAfter: Money;

  // Auditoria
  public readonly createdAt: Date;

  constructor(args: Args) {
    const id = args.id.trim();
    if (id.length === 0) {
      throw new Error('ledger item id is required');
    }
    const transactionId = args.transactionId.trim();
    if (transactionId.length === 0) {
      throw new Error('ledger item transactionId is required');
    }
    const walletId = args.walletId.trim();
    if (walletId.length === 0) {
      throw new Error('ledger item walletId is required');
    }
    if (!args.amount.isPositive) {
      throw new Error('ledger item amount must be positive');
    }
    if (args.balanceBefore.isNegative || args.balanceAfter.isNegative) {
      throw new Error('ledger item balances cannot be negative');
    }
    if (
      args.balanceBefore.currency !== args.amount.currency ||
      args.balanceAfter.currency !== args.amount.currency
    ) {
      throw new Error('ledger item values must use the same currency');
    }
    if (!isBalanced(args)) {
      throw new Error('ledger item arithmetic invariant is not satisfied');
    }

    this.id = id;
    this.transactionId = transactionId;
    this.walletId = walletId;
    this.type = args.type;
    this.balanceBefore = args.balanceBefore;
    this.amount = args.amount;
    this.balanceAfter = args.balanceAfter;
    this.createdAt = args.createdAt;
  }

  isBalanced(): boolean {
    return isBalanced(this);
  }
}
