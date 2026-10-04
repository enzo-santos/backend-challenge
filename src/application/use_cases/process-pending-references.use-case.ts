import { TransactionStatus } from '@/src/domain/transaction';
import type { Transaction } from '@/src/domain/transaction';
import type { UseCase } from '.';
import type { TransactionRepository } from '../ports/persistence/transaction-repository.port';
import type {
  ProcessTransactionInput,
  ProcessTransactionOutput,
} from './process-transaction.use-case';
import type { UnitOfWork } from '../ports/persistence/unit-of-work.port';
import type { OutboxMessageRepository } from '../ports/persistence/outbox-message-repository.port';
import { OutboxMessage } from '@/src/domain/outbox-message';
import { WagerTransactionRejected } from '@/src/domain/integration-event';
import { randomUUIDv7 } from 'crypto';

export type ProcessPendingReferencesInput = {
  limit?: number;
  now?: Date;
  maxAttempts?: number;
  baseBackoffMs?: number;
};

type ProcessPendingReferencesData = {
  inspected: number;
  processed: number;
  rejected: number;
  stillPending: number;
};

export type ProcessPendingReferencesOutput =
  | {
      type: 'success';
      data: ProcessPendingReferencesData;
    }
  | {
      type: 'failure';
      code: 'INVALID_LIMIT' | 'INVALID_MAX_ATTEMPTS' | 'INVALID_BACKOFF';
    };

type Args = {
  transactionRepository: TransactionRepository;
  processTransactionUseCase: (
    input: ProcessTransactionInput,
  ) => Promise<ProcessTransactionOutput>;
  outboxMessageRepository: OutboxMessageRepository;
  unitOfWork: UnitOfWork;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const MISSING_REFERENCE_FAILURE_CODE = 'REFERENCE_NOT_FOUND_RETRY_EXHAUSTED';

export class ProcessPendingReferencesUseCase implements UseCase<
  ProcessPendingReferencesInput,
  ProcessPendingReferencesOutput
> {
  private readonly transactionRepository: TransactionRepository;
  private readonly processTransactionUseCase: (
    input: ProcessTransactionInput,
  ) => Promise<ProcessTransactionOutput>;
  private readonly outboxMessageRepository: OutboxMessageRepository;
  private readonly unitOfWork: UnitOfWork;

  constructor(args: Args) {
    this.transactionRepository = args.transactionRepository;
    this.processTransactionUseCase = args.processTransactionUseCase;
    this.outboxMessageRepository = args.outboxMessageRepository;
    this.unitOfWork = args.unitOfWork;
  }

  async execute(
    input: ProcessPendingReferencesInput,
  ): Promise<ProcessPendingReferencesOutput> {
    return this.unitOfWork.execute(() => this.executeWithinTransaction(input));
  }

  private async executeWithinTransaction(
    input: ProcessPendingReferencesInput,
  ): Promise<ProcessPendingReferencesOutput> {
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

    const now = input.now ?? new Date();
    const pendingReferences =
      await this.transactionRepository.readPendingReferences({
        limit,
        now,
      });

    const data: ProcessPendingReferencesData = {
      inspected: pendingReferences.length,
      processed: 0,
      rejected: 0,
      stillPending: 0,
    };

    for (const pendingReference of pendingReferences) {
      const { transaction, attempts } = pendingReference;
      if (attempts >= maxAttempts) {
        const rejectedTransaction =
          await this.transactionRepository.rejectPendingReference(
            transaction.id,
            MISSING_REFERENCE_FAILURE_CODE,
          );
        const event = new WagerTransactionRejected({
          eventId: randomUUIDv7(),
          aggregateId: rejectedTransaction.id,
          correlationId: rejectedTransaction.id,
          occurredAt: new Date(),
          data: {
            transactionId: rejectedTransaction.id,
            providerId: rejectedTransaction.providerId,
            externalTransactionId: rejectedTransaction.externalId,
            walletId: rejectedTransaction.walletId,
            type: rejectedTransaction.type,
            amount: rejectedTransaction.amount,
            balance: undefined,
            failureCode: rejectedTransaction.failureCode,
          },
        });
        await this.outboxMessageRepository.create(
          OutboxMessage.enqueue(randomUUIDv7(), event),
        );
        data.rejected += 1;
        continue;
      }

      const result = await this.processTransactionUseCase(
        this.createInput(transaction),
      );

      switch (result.status) {
        case TransactionStatus.Processed:
          data.processed += 1;
          break;
        case TransactionStatus.PendingReference:
          await this.transactionRepository.schedulePendingReferenceRetry(
            transaction.id,
            this.calculateNextAttemptAt(now, attempts, baseBackoffMs),
          );
          data.stillPending += 1;
          break;
        case TransactionStatus.Rejected:
        case TransactionStatus.Failed:
          data.rejected += 1;
          break;
        case TransactionStatus.Pending:
          data.stillPending += 1;
          break;
      }
    }

    return { type: 'success', data };
  }

  private createInput(transaction: Transaction): ProcessTransactionInput {
    if (
      transaction.externalId == null ||
      transaction.playerId == null ||
      transaction.roundId == null ||
      transaction.gameId == null
    ) {
      throw new Error(
        `pending transaction ${transaction.id} has incomplete processing data`,
      );
    }

    return {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalId: transaction.externalId,
      walletId: transaction.walletId,
      type: transaction.type,
      amount: transaction.amount,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      referencedId: transaction.referencedId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
    };
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
