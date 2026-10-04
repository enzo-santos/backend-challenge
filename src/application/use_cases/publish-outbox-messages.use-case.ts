import type { UseCase } from '.';
import type { OutboxMessagePublisher } from '../ports/messaging/outbox-message-publisher.port';
import type { OutboxMessageRepository } from '../ports/persistence/outbox-message-repository.port';

export type PublishOutboxMessagesInput = {
  limit?: number;
  now?: Date;
  maxAttempts?: number;
  baseBackoffMs?: number;
  leaseDurationMs?: number;
};

type PublishOutboxMessagesData = {
  inspected: number;
  published: number;
  scheduledForRetry: number;
  permanentlyFailed: number;
};

export type PublishOutboxMessagesOutput =
  | {
      type: 'success';
      data: PublishOutboxMessagesData;
    }
  | {
      type: 'failure';
      code:
        | 'INVALID_LIMIT'
        | 'INVALID_MAX_ATTEMPTS'
        | 'INVALID_BACKOFF'
        | 'INVALID_LEASE_DURATION';
    };

type Args = {
  outboxMessageRepository: OutboxMessageRepository;
  outboxMessagePublisher: OutboxMessagePublisher;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

export class PublishOutboxMessagesUseCase implements UseCase<
  PublishOutboxMessagesInput,
  PublishOutboxMessagesOutput
> {
  private readonly outboxMessageRepository: OutboxMessageRepository;
  private readonly outboxMessagePublisher: OutboxMessagePublisher;

  constructor(args: Args) {
    this.outboxMessageRepository = args.outboxMessageRepository;
    this.outboxMessagePublisher = args.outboxMessagePublisher;
  }

  async execute(
    input: PublishOutboxMessagesInput,
  ): Promise<PublishOutboxMessagesOutput> {
    const limit = input.limit ?? DEFAULT_LIMIT;
    if (limit < 1 || limit > MAX_LIMIT) {
      return { type: 'failure', code: 'INVALID_LIMIT' };
    }

    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    if (maxAttempts < 1) {
      return { type: 'failure', code: 'INVALID_MAX_ATTEMPTS' };
    }

    const baseBackoffMs = input.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    if (baseBackoffMs < 1) {
      return { type: 'failure', code: 'INVALID_BACKOFF' };
    }

    const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (leaseDurationMs < 1) {
      return { type: 'failure', code: 'INVALID_LEASE_DURATION' };
    }

    const now = input.now ?? new Date();
    const messages = await this.outboxMessageRepository.claimDue({
      limit,
      now,
      leaseDurationMs,
    });

    const data: PublishOutboxMessagesData = {
      inspected: messages.length,
      published: 0,
      scheduledForRetry: 0,
      permanentlyFailed: 0,
    };

    for (const claimedMessage of messages) {
      let message = claimedMessage;
      const result = await this.outboxMessagePublisher.publish(message);

      if (result.type === 'published') {
        message = message.markPublished(now);
        await this.outboxMessageRepository.save(message);
        data.published += 1;
        continue;
      }

      if (!result.retryable || message.attempts + 1 >= maxAttempts) {
        message = message.markPermanentlyFailed(now, result.code);
        await this.outboxMessageRepository.save(message);
        data.permanentlyFailed += 1;
        continue;
      }

      message = message.scheduleRetry(
        this.calculateNextAttemptAt(now, message.attempts, baseBackoffMs),
      );
      await this.outboxMessageRepository.save(message);
      data.scheduledForRetry += 1;
    }

    return { type: 'success', data };
  }

  private calculateNextAttemptAt(
    now: Date,
    attempts: number,
    baseBackoffMs: number,
  ): Date {
    const exponent = Math.min(Math.max(attempts, 0), 30);
    const delay = Math.min(baseBackoffMs * 2 ** exponent, MAX_BACKOFF_MS);
    return new Date(now.getTime() + delay);
  }
}
