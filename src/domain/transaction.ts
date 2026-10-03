import { Money } from './money';

export enum TransactionType {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum TransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

type Args = {
  id: string;
  walletId: string;
  providerId: string;
  externalId: string | undefined;
  type: TransactionType;
  status: TransactionStatus;
  amount: Money;
  roundId: string | undefined;
  gameId: string | undefined;
};

export class Transaction {
  public readonly id: string;
  public readonly walletId: string;
  public readonly providerId: string;
  public readonly externalId: string | undefined;
  public readonly type: TransactionType;
  public readonly status: TransactionStatus;
  public readonly amount: Money;
  public readonly roundId: string | undefined;
  public readonly gameId: string | undefined;

  constructor(args: Args) {
    this.id = args.id;
    this.walletId = args.walletId;
    this.providerId = args.providerId;
    this.externalId = args.externalId;
    this.type = args.type;
    this.status = args.status;
    this.amount = args.amount;
    this.roundId = args.roundId;
    this.gameId = args.gameId;
  }
}
