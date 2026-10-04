import { Money } from './money';

export type IntegrationEventProps<Data> = {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: Data;
};

export type IntegrationEventEnvelope<Data> = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  version: number;
  data: Data;
};

export abstract class IntegrationEvent<Data> {
  public abstract readonly eventType: string;
  public abstract readonly version: number;
  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly correlationId: string;
  public readonly causationId: string | undefined;
  public readonly occurredAt: Date;
  public readonly data: Readonly<Data>;

  protected constructor(args: IntegrationEventProps<Data>) {
    this.eventId = args.eventId;
    this.aggregateId = args.aggregateId;
    this.correlationId = args.correlationId;
    this.causationId = args.causationId;
    this.occurredAt = args.occurredAt;
    this.data = args.data;
  }

  toJSON(): object {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}

export type WagerTransactionEventData = {
  transactionId: string;
  providerId: string;
  externalTransactionId: string | undefined;
  walletId: string;
  type: string;
  amount: Money;
  balance: Money | undefined;
  failureCode: string | undefined;
};

export type WalletBalanceChangedData = {
  walletId: string;
  transactionId: string;
  direction: 'CREDIT' | 'DEBIT';
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  walletVersion: number;
};

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionEventData> {
  public readonly eventType = 'WagerTransactionProcessed';
  public readonly version = 1;

  constructor(args: IntegrationEventProps<WagerTransactionEventData>) {
    super(args);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionEventData> {
  public readonly eventType = 'WagerTransactionRejected';
  public readonly version = 1;

  constructor(args: IntegrationEventProps<WagerTransactionEventData>) {
    super(args);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionEventData> {
  public readonly eventType = 'WagerTransactionPendingReference';
  public readonly version = 1;

  constructor(args: IntegrationEventProps<WagerTransactionEventData>) {
    super(args);
  }
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  public readonly eventType = 'WalletBalanceChanged';
  public readonly version = 1;

  constructor(args: IntegrationEventProps<WalletBalanceChangedData>) {
    super(args);
  }
}
