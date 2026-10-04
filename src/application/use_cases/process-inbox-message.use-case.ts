import { createHash } from 'node:crypto';
import stringify from 'fast-json-stable-stringify';
import type { UseCase } from '.';
import type { InboxMessageRepository } from '../ports/persistence/inbox-message-repository.port';
import { InboxMessage } from '@/src/domain/inbox-message';
import type { UnitOfWork } from '../ports/persistence/unit-of-work.port';

export type ProcessInboxMessageInput<Payload> = {
  consumerName: string;
  messageId: string;
  payload: Payload;
  receivedAt?: Date;
};

export type ProcessInboxMessageOutput =
  | {
      type: 'success';
      data: {
        consumerName: string;
        messageId: string;
        duplicate: boolean;
      };
    }
  | {
      type: 'failure';
      code:
        | 'INVALID_CONSUMER_NAME'
        | 'INVALID_MESSAGE_ID'
        | 'INBOX_PAYLOAD_CONFLICT';
    };

type Args<Payload> = {
  inboxMessageRepository: InboxMessageRepository;
  processMessage: (payload: Payload) => Promise<unknown>;
  unitOfWork: UnitOfWork;
};

export class ProcessInboxMessageUseCase<Payload> implements UseCase<
  ProcessInboxMessageInput<Payload>,
  ProcessInboxMessageOutput
> {
  private readonly inboxMessageRepository: InboxMessageRepository;
  private readonly processMessage: (payload: Payload) => Promise<unknown>;
  private readonly unitOfWork: UnitOfWork;

  constructor(args: Args<Payload>) {
    this.inboxMessageRepository = args.inboxMessageRepository;
    this.processMessage = args.processMessage;
    this.unitOfWork = args.unitOfWork;
  }

  async execute(
    input: ProcessInboxMessageInput<Payload>,
  ): Promise<ProcessInboxMessageOutput> {
    return this.unitOfWork.execute(() => this.executeWithinTransaction(input));
  }

  private async executeWithinTransaction(
    input: ProcessInboxMessageInput<Payload>,
  ): Promise<ProcessInboxMessageOutput> {
    const consumerName = input.consumerName.trim();
    if (consumerName.length === 0) {
      return { type: 'failure', code: 'INVALID_CONSUMER_NAME' };
    }
    const messageId = input.messageId.trim();
    if (messageId.length === 0) {
      return { type: 'failure', code: 'INVALID_MESSAGE_ID' };
    }

    const message = new InboxMessage({
      messageId,
      consumerName,
      payloadHash: this.createPayloadHash(input.payload),
      receivedAt: input.receivedAt ?? new Date(),
    });
    const claim = await this.inboxMessageRepository.claim(message);

    if (claim.type === 'payload_conflict') {
      return { type: 'failure', code: 'INBOX_PAYLOAD_CONFLICT' };
    }
    if (claim.type === 'already_processed') {
      return {
        type: 'success',
        data: {
          consumerName,
          messageId,
          duplicate: true,
        },
      };
    }

    await this.processMessage(input.payload);
    const processedMessage = claim.message.markProcessed(new Date());
    await this.inboxMessageRepository.save(processedMessage);

    return {
      type: 'success',
      data: {
        consumerName,
        messageId,
        duplicate: false,
      },
    };
  }

  private createPayloadHash(payload: Payload): string {
    return createHash('sha256').update(stringify(payload)).digest('hex');
  }
}
