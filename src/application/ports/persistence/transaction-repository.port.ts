import { Transaction, TransactionType } from '@/src/domain/transaction';

export type PendingReferenceTransaction = {
  transaction: Transaction;
  attempts: number;
};

export interface TransactionRepository {
  create(transaction: Transaction): Promise<void>;
  update(transaction: Transaction): Promise<void>;
  read(id: string): Promise<Transaction | undefined>;
  read(
    providerId: string,
    externalId: string,
  ): Promise<Transaction | undefined>;
  checkApplied(
    providerId: string,
    externalId: string,
    type: TransactionType,
  ): Promise<boolean>;
  readPendingReferences(options: {
    limit: number;
    now: Date;
  }): Promise<PendingReferenceTransaction[]>;
  schedulePendingReferenceRetry(
    transactionId: string,
    nextAttemptAt: Date,
  ): Promise<void>;
  rejectPendingReference(
    transactionId: string,
    failureCode: string,
  ): Promise<void>;
}
