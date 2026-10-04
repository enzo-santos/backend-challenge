import { LedgerItem, LedgerItemType } from '@/src/domain/ledger-item';
import {
  LedgerItemCursor,
  LedgerItemPage,
  LedgerItemRepository,
} from '@/src/application/ports/persistence/ledger-item-repository.port';
import { PostgresSession } from './postgres-session';
import { moneyFromRow, requiredDate } from './postgres-mappers';

type LedgerItemRow = {
  id: string;
  transaction_id: string;
  wallet_id: string;
  type: LedgerItemType;
  balance_before: string;
  amount: string;
  balance_after: string;
  currency: string;
  created_at: Date;
};

const SELECT_COLUMNS = `
  id, transaction_id, wallet_id, type,
  balance_before, amount, balance_after, currency, created_at`;

export class PostgresLedgerItemRepository implements LedgerItemRepository {
  constructor(private readonly session: PostgresSession) {}

  async create(item: LedgerItem): Promise<void> {
    await this.session.query(
      `INSERT INTO ledger_items (
         id, transaction_id, wallet_id, type, balance_before, amount,
         balance_after, currency, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        item.id,
        item.transactionId,
        item.walletId,
        item.type,
        item.balanceBefore.toJSON().amount,
        item.amount.toJSON().amount,
        item.balanceAfter.toJSON().amount,
        item.amount.currency,
        item.createdAt,
      ],
    );
  }

  async readAll(walletId: string): Promise<LedgerItem[]> {
    const result = await this.session.query<LedgerItemRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM ledger_items
       WHERE wallet_id = $1
       ORDER BY created_at ASC, id ASC`,
      [walletId],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async readPage(
    walletId: string,
    options: { limit: number; after?: LedgerItemCursor },
  ): Promise<LedgerItemPage> {
    const values: unknown[] = [walletId];
    let cursorClause = '';
    if (options.after != null) {
      values.push(options.after.createdAt, options.after.id);
      cursorClause = `AND (created_at, id) > ($2, $3)`;
    }
    values.push(options.limit + 1);

    const result = await this.session.query<LedgerItemRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM ledger_items
       WHERE wallet_id = $1
       ${cursorClause}
       ORDER BY created_at ASC, id ASC
       LIMIT $${values.length}`,
      values,
    );
    const hasNextPage = result.rows.length > options.limit;
    const rows = hasNextPage
      ? result.rows.slice(0, options.limit)
      : result.rows;
    return {
      items: rows.map((row) => this.toDomain(row)),
      hasNextPage,
    };
  }

  private toDomain(row: LedgerItemRow): LedgerItem {
    return new LedgerItem({
      id: row.id,
      transactionId: row.transaction_id,
      walletId: row.wallet_id,
      type: row.type,
      balanceBefore: moneyFromRow(row.balance_before, row.currency),
      amount: moneyFromRow(row.amount, row.currency),
      balanceAfter: moneyFromRow(row.balance_after, row.currency),
      createdAt: requiredDate(row.created_at),
    });
  }
}
