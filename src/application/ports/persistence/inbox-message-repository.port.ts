import { InboxMessage } from '@/src/domain/inbox-message';

export type InboxMessageClaim =
  | {
      type: 'acquired';
      message: InboxMessage;
    }
  | {
      type: 'already_processed';
      message: InboxMessage;
    }
  | {
      type: 'payload_conflict';
      message: InboxMessage;
    };

export interface InboxMessageRepository {
  /**
   * Must atomically insert or claim the message identified by
   * `(consumerName, messageId)`.
   */
  claim(message: InboxMessage): Promise<InboxMessageClaim>;

  save(message: InboxMessage): Promise<void>;
}
