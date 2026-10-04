import { Wallet } from '@/src/domain/wallet';
import { WalletRepository } from '@/src/application/ports/persistence/wallet-repository.port';
import { PostgresSession } from './postgres-session';
import { moneyFromRow, requiredDate } from './postgres-mappers';
import { ConcurrencyConflictError } from '@/src/application/ports/persistence/concurrency-conflict.error';

type WalletRow = {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export class PostgresWalletRepository implements WalletRepository {
  constructor(private readonly session: PostgresSession) {}

  async exists(playerId: string, currency: string): Promise<boolean> {
    const result = await this.session.query(
      `SELECT 1
       FROM wallets
       WHERE player_id = $1 AND currency = $2
       LIMIT 1`,
      [playerId, currency],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async create(wallet: Wallet): Promise<void> {
    await this.session.query(
      `INSERT INTO wallets (
         id, player_id, currency, balance, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        wallet.id,
        wallet.playerId,
        wallet.currency,
        wallet.balance.toJSON().amount,
        wallet.version,
        wallet.createdAt,
        wallet.updatedAt,
      ],
    );
  }

  async read(id: string): Promise<Wallet | undefined> {
    const result = await this.session.query<WalletRow>(
      `SELECT id, player_id, currency, balance, version, created_at, updated_at
       FROM wallets
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row == null ? undefined : this.toDomain(row);
  }

  async update(wallet: Wallet): Promise<void> {
    const result = await this.session.query(
      `UPDATE wallets
       SET balance = $2, version = $3, updated_at = $4
       WHERE id = $1 AND version = $3 - 1`,
      [
        wallet.id,
        wallet.balance.toJSON().amount,
        wallet.version,
        wallet.updatedAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new ConcurrencyConflictError(
        `wallet ${wallet.id} changed concurrently`,
      );
    }
  }

  private toDomain(row: WalletRow): Wallet {
    return new Wallet({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: moneyFromRow(row.balance, row.currency),
      version: row.version,
      createdAt: requiredDate(row.created_at),
      updatedAt: requiredDate(row.updated_at),
    });
  }
}
