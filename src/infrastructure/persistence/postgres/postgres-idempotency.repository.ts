import {
  IdempotencyKey,
  IdempotencyRecord,
  IdempotencyRepository,
} from '@/src/application/ports/persistence/idempotency-repository.port';
import { PostgresSession } from './postgres-session';

type IdempotencyRow<Output> = {
  payload_hash: string;
  idempotency_output: Output;
  created_at: Date;
};

export class PostgresIdempotencyRepository<
  Output,
> implements IdempotencyRepository<Output> {
  constructor(
    private readonly session: PostgresSession,
    private readonly deserializeOutput: (value: unknown) => Output = (value) =>
      value as Output,
  ) {}

  async find(
    key: IdempotencyKey,
  ): Promise<IdempotencyRecord<Output> | undefined> {
    await this.session.query(
      `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`,
      [key.providerId, key.idempotencyKey],
    );
    const result = await this.session.query<IdempotencyRow<unknown>>(
      `SELECT payload_hash, idempotency_output, created_at
       FROM transactions
       WHERE provider_id = $1 AND idempotency_key = $2`,
      [key.providerId, key.idempotencyKey],
    );
    const row = result.rows[0];
    if (row == null) {
      return undefined;
    }
    return {
      key,
      hash: row.payload_hash,
      output: this.deserializeOutput(row.idempotency_output),
      createdAt: new Date(row.created_at),
    };
  }

  async save(record: IdempotencyRecord<Output>): Promise<void> {
    const result = await this.session.query(
      `UPDATE transactions
       SET idempotency_output = $3
       WHERE provider_id = $1
         AND idempotency_key = $2
         AND payload_hash = $4`,
      [
        record.key.providerId,
        record.key.idempotencyKey,
        JSON.stringify(record.output),
        record.hash,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error('idempotency record could not be saved');
    }
  }
}
