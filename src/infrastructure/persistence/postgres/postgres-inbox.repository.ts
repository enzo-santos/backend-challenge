import { InboxMessage } from '@/src/domain/inbox-message';
import {
  InboxMessageClaim,
  InboxMessageRepository,
} from '@/src/application/ports/persistence/inbox-message-repository.port';
import { PostgresSession } from './postgres-session';
import { optionalDate, requiredDate } from './postgres-mappers';

type InboxRow = {
  message_id: string;
  consumer_name: string;
  payload_hash: string;
  received_at: Date;
  processed_at: Date | null;
};

export class PostgresInboxMessageRepository implements InboxMessageRepository {
  constructor(private readonly session: PostgresSession) {}

  async claim(message: InboxMessage): Promise<InboxMessageClaim> {
    const inserted = await this.session.query<InboxRow>(
      `INSERT INTO inbox_messages (
         consumer_name, message_id, payload_hash, received_at
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (consumer_name, message_id) DO NOTHING
       RETURNING message_id, consumer_name, payload_hash, received_at, processed_at`,
      [
        message.consumerName,
        message.messageId,
        message.payloadHash,
        message.receivedAt,
      ],
    );
    if (inserted.rows[0] != null) {
      return { type: 'acquired', message: this.toDomain(inserted.rows[0]) };
    }

    const existing = await this.session.query<InboxRow>(
      `SELECT message_id, consumer_name, payload_hash, received_at, processed_at
       FROM inbox_messages
       WHERE consumer_name = $1 AND message_id = $2
       FOR UPDATE`,
      [message.consumerName, message.messageId],
    );
    const row = existing.rows[0];
    if (row == null) {
      throw new Error('inbox message disappeared after conflict');
    }

    const stored = this.toDomain(row);
    if (stored.payloadHash !== message.payloadHash) {
      return { type: 'payload_conflict', message: stored };
    }
    if (stored.isProcessed()) {
      return { type: 'already_processed', message: stored };
    }
    return { type: 'acquired', message: stored };
  }

  async save(message: InboxMessage): Promise<void> {
    const result = await this.session.query(
      `UPDATE inbox_messages
       SET processed_at = $3
       WHERE consumer_name = $1 AND message_id = $2`,
      [message.consumerName, message.messageId, message.processedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `inbox message ${message.consumerName}/${message.messageId} not found`,
      );
    }
  }

  private toDomain(row: InboxRow): InboxMessage {
    return new InboxMessage({
      messageId: row.message_id,
      consumerName: row.consumer_name,
      payloadHash: row.payload_hash,
      receivedAt: requiredDate(row.received_at),
      processedAt: optionalDate(row.processed_at),
    });
  }
}
