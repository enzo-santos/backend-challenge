import { OutboxMessage } from '@/src/domain/outbox-message';

export type PublishOutboxMessageResult =
  | { type: 'published' }
  | {
      type: 'failure';
      retryable: boolean;
      code: string;
    };

export interface OutboxMessagePublisher {
  publish(message: OutboxMessage): Promise<PublishOutboxMessageResult>;
}
