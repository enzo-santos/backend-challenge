import { Transaction } from '@/src/domain/transaction';

export interface TransactionRepository {
  create(transaction: Transaction): Promise<void>;
}
