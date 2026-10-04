import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/src/domain/transaction';
import {
  PendingReferenceTransaction,
  TransactionRepository,
} from '@/src/application/ports/persistence/transaction-repository.port';
import { PostgresSession } from './postgres-session';
import { moneyFromRow, optionalDate, requiredDate } from './postgres-mappers';

type TransactionRow = {
  id: string;
  wallet_id: string;
  provider_id: string;
  external_id: string | null;
  idempotency_key: string | null;
  payload_hash: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: string;
  player_id: string | null;
  round_id: string | null;
  game_id: string | null;
  failure_code: string | null;
  referenced_id: string | null;
  created_at: Date;
  processed_at: Date | null;
  pending_attempts: number;
  next_attempt_at: Date | null;
};

const SELECT_COLUMNS = `
  id, wallet_id, provider_id, external_id, idempotency_key, payload_hash,
  type, status, amount, currency, player_id, round_id, game_id,
  failure_code, referenced_id, created_at, processed_at,
  pending_attempts, next_attempt_at`;

export class PostgresTransactionRepository implements TransactionRepository {
  constructor(private readonly session: PostgresSession) {}

  async create(transaction: Transaction): Promise<void> {
    await this.session.query(
      `INSERT INTO transactions (
         id, wallet_id, provider_id, external_id, idempotency_key,
         payload_hash, type, status, amount, currency, player_id, round_id,
         game_id, failure_code, referenced_id, created_at, processed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17
       )`,
      this.values(transaction),
    );
  }

  async update(transaction: Transaction): Promise<void> {
    const result = await this.session.query(
      `UPDATE transactions
       SET wallet_id = $2, provider_id = $3, external_id = $4,
           idempotency_key = $5, payload_hash = $6, type = $7, status = $8,
           amount = $9, currency = $10, player_id = $11, round_id = $12,
           game_id = $13, failure_code = $14, referenced_id = $15,
           created_at = $16, processed_at = $17
       WHERE id = $1`,
      this.values(transaction),
    );
    if (result.rowCount !== 1) {
      throw new Error(`transaction ${transaction.id} not found`);
    }
  }

  async updateIfStatus(
    transaction: Transaction,
    expectedStatus: TransactionStatus,
  ): Promise<boolean> {
    const result = await this.session.query(
      `UPDATE transactions
       SET wallet_id = $2, provider_id = $3, external_id = $4,
           idempotency_key = $5, payload_hash = $6, type = $7, status = $8,
           amount = $9, currency = $10, player_id = $11, round_id = $12,
           game_id = $13, failure_code = $14, referenced_id = $15,
           created_at = $16, processed_at = $17
       WHERE id = $1 AND status = $18`,
      [...this.values(transaction), expectedStatus],
    );
    return result.rowCount === 1;
  }

  async read(id: string): Promise<Transaction | undefined>;
  async read(
    providerId: string,
    externalId: string,
  ): Promise<Transaction | undefined>;
  async read(first: string, second?: string): Promise<Transaction | undefined> {
    const result = await this.session.query<TransactionRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM transactions
       WHERE ${second == null ? 'id = $1' : 'provider_id = $1 AND external_id = $2'}
       LIMIT 1`,
      second == null ? [first] : [first, second],
    );
    const row = result.rows[0];
    return row == null ? undefined : this.toDomain(row);
  }

  async checkApplied(
    providerId: string,
    externalId: string,
    type: TransactionType,
  ): Promise<boolean> {
    const result = await this.session.query(
      `SELECT 1
       FROM transactions
       WHERE provider_id = $1
         AND external_id = $2
         AND type = $3
         AND status = $4
       LIMIT 1`,
      [providerId, externalId, type, TransactionStatus.Processed],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async readPendingReferences(options: {
    limit: number;
    now: Date;
  }): Promise<PendingReferenceTransaction[]> {
    const result = await this.session.query<
      TransactionRow & { pending_attempts: number }
    >(
      `SELECT ${SELECT_COLUMNS}
       FROM transactions
       WHERE status = $1
         AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
       ORDER BY next_attempt_at ASC NULLS FIRST, created_at ASC, id ASC
       LIMIT $3`,
      [TransactionStatus.PendingReference, options.now, options.limit],
    );
    return result.rows.map((row) => ({
      transaction: this.toDomain(row),
      attempts: row.pending_attempts,
    }));
  }

  async schedulePendingReferenceRetry(
    transactionId: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    const result = await this.session.query(
      `UPDATE transactions
       SET pending_attempts = pending_attempts + 1,
           next_attempt_at = $2
       WHERE id = $1 AND status = $3`,
      [transactionId, nextAttemptAt, TransactionStatus.PendingReference],
    );
    if (result.rowCount !== 1) {
      throw new Error(`pending transaction ${transactionId} changed`);
    }
  }

  async rejectPendingReference(
    transactionId: string,
    failureCode: string,
  ): Promise<Transaction> {
    const result = await this.session.query<TransactionRow>(
      `UPDATE transactions
       SET status = $2, failure_code = $3, next_attempt_at = NULL
       WHERE id = $1 AND status = $4
       RETURNING ${SELECT_COLUMNS}`,
      [
        transactionId,
        TransactionStatus.Rejected,
        failureCode,
        TransactionStatus.PendingReference,
      ],
    );
    const row = result.rows[0];
    if (row == null) {
      throw new Error(`pending transaction ${transactionId} changed`);
    }
    return this.toDomain(row);
  }

  private values(transaction: Transaction): unknown[] {
    return [
      transaction.id,
      transaction.walletId,
      transaction.providerId,
      transaction.externalId,
      transaction.idempotencyKey,
      transaction.payloadHash,
      transaction.type,
      transaction.status,
      transaction.amount.toJSON().amount,
      transaction.amount.currency,
      transaction.playerId,
      transaction.roundId,
      transaction.gameId,
      transaction.failureCode,
      transaction.referencedId,
      transaction.createdAt,
      transaction.processedAt,
    ];
  }

  private toDomain(row: TransactionRow): Transaction {
    return new Transaction({
      id: row.id,
      walletId: row.wallet_id,
      providerId: row.provider_id,
      externalId: row.external_id ?? undefined,
      type: row.type,
      status: row.status,
      amount: moneyFromRow(row.amount, row.currency),
      playerId: row.player_id ?? undefined,
      roundId: row.round_id ?? undefined,
      gameId: row.game_id ?? undefined,
      failureCode: row.failure_code ?? undefined,
      referencedId: row.referenced_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      payloadHash: row.payload_hash ?? undefined,
      createdAt: requiredDate(row.created_at),
      processedAt: optionalDate(row.processed_at),
    });
  }
}
