import { OutboxMessage } from '@/src/domain/outbox-message';

export interface OutboxMessageRepository {
  create(message: OutboxMessage): Promise<void>;
  claimDue(options: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<OutboxMessage[]>;
  save(message: OutboxMessage): Promise<void>;
}
