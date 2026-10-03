import { Money } from './money';

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
  public readonly id: string;
  public readonly transactionId: string;
  public readonly walletId: string;
  public readonly type: LedgerItemType;
  public readonly balanceBefore: Money;
  public readonly amount: Money;
  public readonly balanceAfter: Money;
  public readonly createdAt: Date;

  constructor(args: Args) {
    this.id = args.id;
    this.transactionId = args.transactionId;
    this.walletId = args.walletId;
    this.type = args.type;
    this.balanceBefore = args.balanceBefore;
    this.amount = args.amount;
    this.balanceAfter = args.balanceAfter;
    this.createdAt = args.createdAt;
  }
}
