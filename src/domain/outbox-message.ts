import { IntegrationEvent } from './integration-event';

type Args = {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  publishedAt?: Date;
  failedAt?: Date;
  failureCode?: string;
};

export class OutboxMessage {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  public readonly payload: Readonly<Record<string, unknown>>;
  public readonly occurredAt: Date;
  public readonly attempts: number;
  public readonly nextAttemptAt: Date | undefined;
  public readonly leaseUntil: Date | undefined;
  public readonly publishedAt: Date | undefined;
  public readonly failedAt: Date | undefined;
  public readonly failureCode: string | undefined;

  static enqueue(id: string, event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage({
      id,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON() as unknown as Record<string, unknown>,
      occurredAt: event.occurredAt,
      attempts: 0,
    });
  }

  constructor(args: Args) {
    this.id = args.id;
    this.aggregateId = args.aggregateId;
    this.eventType = args.eventType;
    this.payload = args.payload;
    this.occurredAt = args.occurredAt;
    this.attempts = args.attempts;
    this.nextAttemptAt = args.nextAttemptAt;
    this.leaseUntil = args.leaseUntil;
    this.publishedAt = args.publishedAt;
    this.failedAt = args.failedAt;
    this.failureCode = args.failureCode;
  }

  isPending(): boolean {
    return this.publishedAt == null && this.failedAt == null;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (this.nextAttemptAt == null || this.nextAttemptAt <= now)
    );
  }

  markPublished(at: Date): OutboxMessage {
    if (!this.isPending()) {
      throw new Error(`outbox message ${this.id} is already terminal`);
    }

    return new OutboxMessage({
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload,
      occurredAt: this.occurredAt,
      attempts: this.attempts + 1,
      leaseUntil: undefined,
      publishedAt: at,
    });
  }

  scheduleRetry(nextAttemptAt: Date): OutboxMessage {
    if (!this.isPending()) {
      throw new Error(`outbox message ${this.id} is already terminal`);
    }

    return new OutboxMessage({
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload,
      occurredAt: this.occurredAt,
      attempts: this.attempts + 1,
      nextAttemptAt,
      leaseUntil: undefined,
    });
  }

  markPermanentlyFailed(at: Date, failureCode: string): OutboxMessage {
    if (!this.isPending()) {
      throw new Error(`outbox message ${this.id} is already terminal`);
    }

    return new OutboxMessage({
      id: this.id,
      aggregateId: this.aggregateId,
      eventType: this.eventType,
      payload: this.payload,
      occurredAt: this.occurredAt,
      attempts: this.attempts + 1,
      leaseUntil: undefined,
      failedAt: at,
      failureCode,
    });
  }
}
