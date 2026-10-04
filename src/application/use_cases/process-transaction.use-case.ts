import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/src/domain/transaction';
import { UseCase } from '.';
import { Money } from '@/src/domain/money';
import { WalletRepository } from '../ports/persistence/wallet-repository.port';
import { randomUUIDv7 } from 'crypto';
import { LedgerItemRepository } from '../ports/persistence/ledger-item-repository.port';
import { LedgerItem, LedgerItemType } from '@/src/domain/ledger-item';
import { TransactionRepository } from '../ports/persistence/transaction-repository.port';
import { Wallet } from '@/src/domain/wallet';
import { UnitOfWork } from '../ports/persistence/unit-of-work.port';
import { OutboxMessageRepository } from '../ports/persistence/outbox-message-repository.port';
import { OutboxMessage } from '@/src/domain/outbox-message';
import {
  IntegrationEvent,
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionEventData,
} from '@/src/domain/integration-event';
import { ConcurrencyConflictError } from '../ports/persistence/concurrency-conflict.error';

type Input = {
  transactionId?: string;
  providerId: string;
  externalId: string;
  walletId: string;
  type: TransactionType;
  amount: Money;
  playerId: string;

  roundId: string;
  gameId: string;

  referencedId: string | undefined; // Apenas para REFUND e ROLLBACk
  idempotencyKey?: string;
  payloadHash?: string;
  correlationId?: string;
  causationId?: string;
};

export type ProcessTransactionInput = Input;

type FailureCode =
  | 'INSUFFICIENT_FUNDS' // Para saldo insuficiente
  | 'OPERATION_WOULD_OVERDRAW'
  | 'ROLLBACK_WOULD_OVERDRAW'
  | 'OPERATION_ALREADY_APPLIED' // Para REFUND/ROLLBACK cuja transação original já foi aplicada
  | 'REFERENCE_NOT_FOUND' // Para REFUND/ROLLBACK sem referencedId
  | 'INVALID_REFERENCE_TYPE' // Para REFUND cujo tipo da transação original não é BET
  | 'INVALID_REFERENCE_STATUS' // Para REFUND cujo status da transação original não é PROCESSED
  | 'INVALID_REFERENCE_PROVIDER' // Para REFUND cujo providerId da transação original é diferente do atual
  | 'INVALID_REFERENCE_PLAYER' // Para REFUND cujo playerId da transação original é diferente do atual
  | 'INVALID_REFERENCE_WALLET' // Para REFUND cujo walletId da transação original é diferente do atual
  | 'INVALID_REFERENCE_CURRENCY' // Para REFUND cujo amount.currency da transação original é diferente do atual
  | 'INVALID_REFERENCE_ROUND' // Para REFUND cujo roundId da transação original é diferente do atual
  | 'INVALID_REFERENCE_AMOUNT'; // Para REFUND cujo amount da transação original é diferente do atual

type Calculation =
  | {
      type: 'rejected';
      code: FailureCode;
    }
  | {
      type: 'pending';
    }
  | {
      type: 'processed';
      kind: LedgerItemType | null;
    };

type Output = {
  id: string;
  status: TransactionStatus;
  balance: Money;
  failureCode: string | undefined;
};

export type ProcessTransactionOutput = Output;

type Args = {
  walletRepository: WalletRepository;
  transactionRepository: TransactionRepository;
  ledgerItemRepository: LedgerItemRepository;
  outboxMessageRepository: OutboxMessageRepository;
  unitOfWork: UnitOfWork;
};

export class ProcessTransactionUseCase implements UseCase<Input, Output> {
  private readonly walletRepository: WalletRepository;
  private readonly transactionRepository: TransactionRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;
  private readonly outboxMessageRepository: OutboxMessageRepository;
  private readonly unitOfWork: UnitOfWork;

  constructor(args: Args) {
    this.walletRepository = args.walletRepository;
    this.transactionRepository = args.transactionRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
    this.outboxMessageRepository = args.outboxMessageRepository;
    this.unitOfWork = args.unitOfWork;
  }

  async execute(input: Input): Promise<Output> {
    const maxConcurrencyRetries = 3;
    for (let attempt = 0; attempt <= maxConcurrencyRetries; attempt += 1) {
      try {
        return await this.unitOfWork.execute(() =>
          this.executeWithinTransaction(input),
        );
      } catch (error) {
        if (
          !(error instanceof ConcurrencyConflictError) ||
          attempt === maxConcurrencyRetries
        ) {
          throw error;
        }
      }
    }
    throw new Error('transaction processing retry loop did not complete');
  }

  private async executeWithinTransaction(input: Input): Promise<Output> {
    if (!input.amount.isPositive) {
      throw new Error('amount must be positive');
    }

    const transactionId = input.transactionId ?? randomUUIDv7();

    const existingTransaction =
      input.transactionId == null
        ? undefined
        : await this.transactionRepository.read(input.transactionId);
    if (input.transactionId != null && existingTransaction == null) {
      throw new Error(`transaction not found: ${input.transactionId}`);
    }
    if (existingTransaction?.isTerminal()) {
      throw new Error(
        `transaction ${existingTransaction.id} is already terminal`,
      );
    }

    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      throw new Error('wallet not found');
    }
    if (wallet.balance.currency !== input.amount.currency) {
      throw new Error(
        `invalid currency: expected ${wallet.balance.currency}, got ${input.amount.currency}`,
      );
    }
    if (wallet.playerId !== input.playerId) {
      throw new Error(
        `invalid playerId: expected ${wallet.playerId}, got ${input.playerId}`,
      );
    }

    const output = await this.#calculate(wallet, input);
    let balanceAfter: Money | undefined;
    let updatedWallet: Wallet | undefined;
    let ledgerType: LedgerItemType | undefined;
    let status: TransactionStatus;
    let failureCode: FailureCode | undefined;
    switch (output.type) {
      case 'processed':
        if (output.kind == null) {
          status = TransactionStatus.Processed;
        } else {
          if (
            output.kind === LedgerItemType.Debit &&
            wallet.balance.isLessThan(input.amount)
          ) {
            status = TransactionStatus.Rejected;
            failureCode =
              input.type === TransactionType.Rollback
                ? 'ROLLBACK_WOULD_OVERDRAW'
                : 'OPERATION_WOULD_OVERDRAW';
          } else {
            updatedWallet =
              output.kind === LedgerItemType.Credit
                ? wallet.withCredit(input.amount)
                : wallet.withDebit(input.amount);
            balanceAfter = updatedWallet.balance;
            ledgerType = output.kind;
            status = TransactionStatus.Processed;

            const item = new LedgerItem({
              id: randomUUIDv7(),
              transactionId: transactionId,
              walletId: wallet.id,
              type: output.kind,
              balanceBefore: wallet.balance,
              amount: input.amount,
              balanceAfter: balanceAfter,
              createdAt: new Date(),
            });

            await this.walletRepository.update(updatedWallet);
            await this.ledgerItemRepository.create(item);
          }
        }
        break;

      case 'pending':
        status = TransactionStatus.PendingReference;
        break;

      case 'rejected':
        status = TransactionStatus.Rejected;
        failureCode = output.code;
        break;
    }

    const pendingTransaction =
      existingTransaction ??
      new Transaction({
        id: transactionId,
        walletId: input.walletId,
        providerId: input.providerId,
        externalId: input.externalId,
        amount: input.amount,
        type: input.type,
        status: TransactionStatus.Pending,
        playerId: input.playerId,
        gameId: input.gameId,
        roundId: input.roundId,
        failureCode: undefined,
        referencedId: input.referencedId,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
      });

    const transaction =
      status === TransactionStatus.Processed
        ? pendingTransaction.markProcessed()
        : status === TransactionStatus.PendingReference
          ? pendingTransaction.markPendingReference()
          : pendingTransaction.reject(failureCode as string);
    if (input.transactionId == null) {
      await this.transactionRepository.create(transaction);
    } else {
      const updated = await this.transactionRepository.updateIfStatus(
        transaction,
        existingTransaction?.status ?? TransactionStatus.Pending,
      );
      if (!updated) {
        throw new ConcurrencyConflictError(
          `transaction ${transaction.id} changed concurrently`,
        );
      }
    }

    const occurredAt = new Date();
    const eventData: WagerTransactionEventData = {
      transactionId: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalId,
      walletId: transaction.walletId,
      type: transaction.type,
      amount: transaction.amount,
      balance: balanceAfter ?? wallet.balance,
      failureCode: transaction.failureCode,
    };
    let event: IntegrationEvent<WagerTransactionEventData>;
    if (transaction.status === TransactionStatus.Processed) {
      event = new WagerTransactionProcessed({
        eventId: randomUUIDv7(),
        aggregateId: transaction.id,
        correlationId: input.correlationId ?? transaction.id,
        causationId: input.causationId,
        occurredAt,
        data: eventData,
      });
    } else if (transaction.status === TransactionStatus.PendingReference) {
      event = new WagerTransactionPendingReference({
        eventId: randomUUIDv7(),
        aggregateId: transaction.id,
        correlationId: input.correlationId ?? transaction.id,
        causationId: input.causationId,
        occurredAt,
        data: eventData,
      });
    } else {
      event = new WagerTransactionRejected({
        eventId: randomUUIDv7(),
        aggregateId: transaction.id,
        correlationId: input.correlationId ?? transaction.id,
        causationId: input.causationId,
        occurredAt,
        data: eventData,
      });
    }
    await this.outboxMessageRepository.create(
      OutboxMessage.enqueue(randomUUIDv7(), event),
    );

    if (updatedWallet != null && ledgerType != null && balanceAfter != null) {
      const balanceChanged = new WalletBalanceChanged({
        eventId: randomUUIDv7(),
        aggregateId: wallet.id,
        correlationId: input.correlationId ?? transaction.id,
        causationId: input.causationId,
        occurredAt,
        data: {
          walletId: wallet.id,
          transactionId: transaction.id,
          direction: ledgerType,
          money: input.amount,
          balanceBefore: wallet.balance,
          balanceAfter: balanceAfter,
          walletVersion: updatedWallet.version,
        },
      });
      await this.outboxMessageRepository.create(
        OutboxMessage.enqueue(randomUUIDv7(), balanceChanged),
      );
    }
    return {
      id: transactionId,
      status: transaction.status,
      balance: balanceAfter ?? wallet.balance,
      failureCode: transaction.failureCode,
    };
  }

  async #calculate(wallet: Wallet, input: Input): Promise<Calculation> {
    const referencedId = input.referencedId;
    let transaction: Transaction | undefined;
    switch (input.type) {
      case TransactionType.Bet:
        // Rejeitar se saldo insuficiente
        if (wallet.balance.isLessThan(input.amount)) {
          return {
            type: 'rejected',
            code: 'INSUFFICIENT_FUNDS',
          };
        }
        return {
          type: 'processed',
          kind: LedgerItemType.Debit,
        };

      case TransactionType.Win:
        return {
          type: 'processed',
          kind: LedgerItemType.Credit,
        };

      case TransactionType.Loss:
        // Registra o resultado sem mover saldo
        return { type: 'processed', kind: null };

      case TransactionType.Refund:
        if (referencedId == null) {
          return { type: 'rejected', code: 'REFERENCE_NOT_FOUND' };
        }
        const isRefunded = await this.transactionRepository.checkApplied(
          input.providerId,
          referencedId,
          TransactionType.Refund,
        );
        if (isRefunded) {
          return { type: 'rejected', code: 'OPERATION_ALREADY_APPLIED' };
        }
        transaction = await this.transactionRepository.read(
          input.providerId,
          referencedId,
        );
        if (transaction == null) {
          return { type: 'pending' };
        }
        if (transaction.type !== TransactionType.Bet) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_TYPE',
          };
        }
        if (transaction.status !== TransactionStatus.Processed) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_STATUS',
          };
        }
        if (transaction.playerId !== input.playerId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_PLAYER',
          };
        }
        if (transaction.providerId !== input.providerId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_PROVIDER',
          };
        }
        if (transaction.walletId !== input.walletId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_WALLET',
          };
        }
        if (transaction.amount.currency !== input.amount.currency) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_CURRENCY',
          };
        }
        if (transaction.roundId !== input.roundId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_ROUND',
          };
        }
        if (!transaction.amount.equals(input.amount)) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_AMOUNT',
          };
        }
        return { type: 'processed', kind: LedgerItemType.Credit };

      case TransactionType.Rollback:
        if (referencedId == null) {
          return { type: 'rejected', code: 'REFERENCE_NOT_FOUND' };
        }
        const isRolledBack = await this.transactionRepository.checkApplied(
          input.providerId,
          referencedId,
          TransactionType.Rollback,
        );
        if (isRolledBack) {
          return { type: 'rejected', code: 'OPERATION_ALREADY_APPLIED' };
        }
        transaction = await this.transactionRepository.read(
          input.providerId,
          referencedId,
        );
        if (transaction == null) {
          return { type: 'pending' };
        }
        if (transaction.status !== TransactionStatus.Processed) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_STATUS',
          };
        }
        if (transaction.playerId !== input.playerId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_PLAYER',
          };
        }
        if (transaction.providerId !== input.providerId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_PROVIDER',
          };
        }
        if (transaction.walletId !== input.walletId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_WALLET',
          };
        }
        if (transaction.amount.currency !== input.amount.currency) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_CURRENCY',
          };
        }
        if (transaction.roundId !== input.roundId) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_ROUND',
          };
        }
        if (!transaction.amount.equals(input.amount)) {
          return {
            type: 'rejected',
            code: 'INVALID_REFERENCE_AMOUNT',
          };
        }
        switch (transaction.type) {
          case TransactionType.Bet:
            return {
              type: 'processed',
              kind: LedgerItemType.Credit,
            };
          case TransactionType.Win:
          case TransactionType.Refund:
            return {
              type: 'processed',
              kind: LedgerItemType.Debit,
            };
          default:
            return {
              type: 'rejected',
              code: 'INVALID_REFERENCE_TYPE',
            };
        }

      case TransactionType.Opening:
        throw new Error('invalid type');
    }
  }
}
