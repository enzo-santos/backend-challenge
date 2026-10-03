import { Transaction, TransactionType } from '@/src/domain/transaction';

export interface TransactionRepository {
  create(transaction: Transaction): Promise<void>;
  read(id: string): Promise<Transaction | undefined>;
  read(
    providerId: string,
    externalId: string,
  ): Promise<Transaction | undefined>;
  checkApplied(
    providerId: string,
    externalId: string,
    status: TransactionType,
  ): Promise<boolean>;
}
