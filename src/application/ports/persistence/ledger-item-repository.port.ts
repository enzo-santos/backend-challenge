import { LedgerItem } from '@/src/domain/ledger-item';

export type LedgerItemCursor = {
  createdAt: Date;
  id: string;
};

export type LedgerItemPage = {
  items: LedgerItem[];
  hasNextPage: boolean;
};

export interface LedgerItemRepository {
  create(item: LedgerItem): Promise<void>;
  readAll(walletId: string): Promise<LedgerItem[]>;
  readPage(
    walletId: string,
    options: {
      limit: number;
      after?: LedgerItemCursor;
    },
  ): Promise<LedgerItemPage>;
}
