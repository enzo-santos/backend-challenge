import { Money } from './money';

function assertCanTransition(transaction: Transaction): void {
  if (transaction.isTerminal()) {
    throw new Error(
      `transaction ${transaction.id} is terminal with status ${transaction.status}`,
    );
  }
}

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

  playerId: string | undefined;
  roundId: string | undefined;
  gameId: string | undefined;

  type: TransactionType;
  status: TransactionStatus;
  amount: Money;

  failureCode: string | undefined;
  referencedId: string | undefined;

  idempotencyKey?: string;
  payloadHash?: string;

  createdAt?: Date;
  processedAt?: Date;
};

export class Transaction {
  // Chaves primárias e estrangeiras
  public readonly id: string;
  public readonly walletId: string;
  public readonly providerId: string;
  public readonly externalId: string | undefined;

  // Dados da aposta
  public readonly playerId: string | undefined;
  public readonly roundId: string | undefined;
  public readonly gameId: string | undefined;

  // Dados financeiros
  public readonly type: TransactionType;
  public readonly status: TransactionStatus;
  public readonly amount: Money;

  public readonly failureCode: string | undefined;
  public readonly referencedId: string | undefined;

  // Idempotência
  public readonly idempotencyKey: string | undefined;
  public readonly payloadHash: string | undefined;

  public readonly createdAt: Date;
  public readonly processedAt: Date | undefined;

  constructor(args: Args) {
    const id = args.id.trim();
    if (id.length === 0) {
      throw new Error('transaction id is required');
    }
    const walletId = args.walletId.trim();
    if (walletId.length === 0) {
      throw new Error('transaction walletId is required');
    }
    const providerId = args.providerId.trim();
    if (providerId.length === 0) {
      throw new Error('transaction providerId is required');
    }
    const externalId = args.externalId?.trim();
    if (externalId != null && externalId.length === 0) {
      throw new Error('transaction externalId must not be empty');
    }
    if (args.amount.isNegative || args.amount.isZero) {
      throw new Error('transaction amount must be positive');
    }
    const idempotencyKey = args.idempotencyKey?.trim();
    if (
      (idempotencyKey == null) !== (args.payloadHash == null) ||
      idempotencyKey?.length === 0
    ) {
      throw new Error(
        'transaction idempotencyKey and payloadHash must be provided together',
      );
    }
    if (args.payloadHash != null && !/^[a-f0-9]{64}$/.test(args.payloadHash)) {
      throw new Error('transaction payloadHash must be a SHA-256 hex digest');
    }
    if (
      (args.type === TransactionType.Refund ||
        args.type === TransactionType.Rollback) &&
      args.referencedId == null &&
      args.status !== TransactionStatus.Rejected
    ) {
      throw new Error(`${args.type} transaction requires a reference`);
    }
    const failureCode = args.failureCode?.trim();
    if (failureCode != null && failureCode.length === 0) {
      throw new Error('transaction failureCode must not be empty');
    }
    if (
      (args.status === TransactionStatus.Rejected ||
        args.status === TransactionStatus.Failed) !==
      (args.failureCode != null)
    ) {
      throw new Error(
        'rejected and failed transactions require a failureCode, and other statuses forbid it',
      );
    }
    if (
      args.processedAt != null &&
      args.status !== TransactionStatus.Processed
    ) {
      throw new Error('processedAt is only valid for processed transactions');
    }

    this.id = args.id;
    this.walletId = args.walletId;
    this.providerId = args.providerId;
    this.externalId = args.externalId;

    this.playerId = args.playerId;
    this.roundId = args.roundId;
    this.gameId = args.gameId;

    this.type = args.type;
    this.status = args.status;
    this.amount = args.amount;

    this.failureCode = args.failureCode;
    this.referencedId = args.referencedId;

    this.idempotencyKey = args.idempotencyKey;
    this.payloadHash = args.payloadHash;

    this.createdAt = args.createdAt ?? new Date();
    this.processedAt = args.processedAt;
  }

  isTerminal(): boolean {
    return (
      this.status === TransactionStatus.Processed ||
      this.status === TransactionStatus.Rejected ||
      this.status === TransactionStatus.Failed
    );
  }

  requiresReference(): boolean {
    return (
      this.type === TransactionType.Refund ||
      this.type === TransactionType.Rollback
    );
  }

  affectsBalance(): boolean {
    return this.type !== TransactionType.Loss;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  markProcessed(at = new Date()): Transaction {
    assertCanTransition(this);

    return new Transaction({
      ...this,
      status: TransactionStatus.Processed,
      failureCode: undefined,
      processedAt: at,
    });
  }

  markPendingReference(): Transaction {
    assertCanTransition(this);

    return new Transaction({
      ...this,
      status: TransactionStatus.PendingReference,
      failureCode: undefined,
      processedAt: undefined,
    });
  }

  reject(code: string): Transaction {
    assertCanTransition(this);

    return new Transaction({
      ...this,
      status: TransactionStatus.Rejected,
      failureCode: code,
      processedAt: undefined,
    });
  }

  fail(code: string): Transaction {
    assertCanTransition(this);

    return new Transaction({
      ...this,
      status: TransactionStatus.Failed,
      failureCode: code,
      processedAt: undefined,
    });
  }
}
