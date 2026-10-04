import { OutboxMessage } from '@/src/domain/outbox-message';
import { OutboxMessageRepository } from '@/src/application/ports/persistence/outbox-message-repository.port';
import { PostgresSession } from './postgres-session';
import { optionalDate, requiredDate } from './postgres-mappers';

type OutboxRow = {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
  lease_until: Date | null;
  published_at: Date | null;
  failed_at: Date | null;
  failure_code: string | null;
};

const SELECT_COLUMNS = `
  id, aggregate_id, event_type, payload, occurred_at, attempts,
  next_attempt_at, lease_until, published_at, failed_at, failure_code`;

export class PostgresOutboxMessageRepository implements OutboxMessageRepository {
  constructor(private readonly session: PostgresSession) {}

  async create(message: OutboxMessage): Promise<void> {
    await this.session.query(
      `INSERT INTO outbox_messages (
         id, aggregate_id, event_type, payload, occurred_at, attempts,
         next_attempt_at, lease_until, published_at, failed_at, failure_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        message.id,
        message.aggregateId,
        message.eventType,
        message.payload,
        message.occurredAt,
        message.attempts,
        message.nextAttemptAt,
        message.leaseUntil,
        message.publishedAt,
        message.failedAt,
        message.failureCode,
      ],
    );
  }

  async claimDue(options: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<OutboxMessage[]> {
    const leaseUntil = new Date(
      options.now.getTime() + options.leaseDurationMs,
    );
    const result = await this.session.query<OutboxRow>(
      `WITH candidates AS (
         SELECT id
         FROM outbox_messages
         WHERE published_at IS NULL
           AND failed_at IS NULL
           AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
           AND (lease_until IS NULL OR lease_until <= $2)
         ORDER BY occurred_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE outbox_messages AS messages
       SET lease_until = $3
       FROM candidates
       WHERE messages.id = candidates.id
       RETURNING ${SELECT_COLUMNS}`,
      [options.limit, options.now, leaseUntil],
    );
    return result.rows.map((row) => this.toDomain(row));
  }

  async save(message: OutboxMessage): Promise<void> {
    const result = await this.session.query(
      `UPDATE outbox_messages
       SET attempts = $2, next_attempt_at = $3, lease_until = $4,
           published_at = $5, failed_at = $6, failure_code = $7
       WHERE id = $1`,
      [
        message.id,
        message.attempts,
        message.nextAttemptAt,
        message.leaseUntil,
        message.publishedAt,
        message.failedAt,
        message.failureCode,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`outbox message ${message.id} not found`);
    }
  }

  private toDomain(row: OutboxRow): OutboxMessage {
    return new OutboxMessage({
      id: row.id,
      aggregateId: row.aggregate_id,
      eventType: row.event_type,
      payload: row.payload,
      occurredAt: requiredDate(row.occurred_at),
      attempts: row.attempts,
      nextAttemptAt: optionalDate(row.next_attempt_at),
      leaseUntil: optionalDate(row.lease_until),
      publishedAt: optionalDate(row.published_at),
      failedAt: optionalDate(row.failed_at),
      failureCode: row.failure_code ?? undefined,
    });
  }
}
