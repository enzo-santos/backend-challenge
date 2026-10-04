import { Money } from '@/src/domain/money';
import { UseCase } from '.';
import { Wallet } from '@/src/domain/wallet';
import { randomUUIDv7 } from 'bun';
import { WalletRepository } from '../ports/persistence/wallet-repository.port';
import { TransactionRepository } from '../ports/persistence/transaction-repository.port';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/src/domain/transaction';
import { LedgerItemRepository } from '../ports/persistence/ledger-item-repository.port';
import { LedgerItem, LedgerItemType } from '@/src/domain/ledger-item';
import Decimal from 'decimal.js';
import { UnitOfWork } from '../ports/persistence/unit-of-work.port';
import { OutboxMessageRepository } from '../ports/persistence/outbox-message-repository.port';
import { WalletBalanceChanged } from '@/src/domain/integration-event';
import { OutboxMessage } from '@/src/domain/outbox-message';

type Input = {
  playerId: string;
  initialBalance: Money;
};

type Args = {
  walletRepository: WalletRepository;
  transactionRepository: TransactionRepository;
  ledgerItemRepository: LedgerItemRepository;
  outboxMessageRepository: OutboxMessageRepository;
  unitOfWork: UnitOfWork;
};

export class CreateWalletUseCase implements UseCase<Input, Wallet> {
  private readonly walletRepository: WalletRepository;
  private readonly transactionRepository: TransactionRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;
  private readonly outboxMessageRepository: OutboxMessageRepository;
  private readonly unitOfWork: UnitOfWork;

  constructor(readonly args: Args) {
    this.walletRepository = args.walletRepository;
    this.transactionRepository = args.transactionRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
    this.outboxMessageRepository = args.outboxMessageRepository;
    this.unitOfWork = args.unitOfWork;
  }

  async execute(input: Input): Promise<Wallet> {
    return this.unitOfWork.execute(() => this.executeWithinTransaction(input));
  }

  private async executeWithinTransaction(input: Input): Promise<Wallet> {
    const { playerId, initialBalance } = input;

    // Valida saldo inicial
    if (initialBalance.isNegative) {
      throw new Error(
        `given balance is invalid: expected >= 0, got ${initialBalance}`,
      );
    }
    // Valida wallet já existente
    if (await this.walletRepository.exists(playerId, initialBalance.currency)) {
      throw new Error(
        `wallet already exists for given player ID (${playerId}) and currency (${initialBalance.currency})`,
      );
    }

    const wallet = new Wallet({
      id: randomUUIDv7(),
      balance: initialBalance,
      createdAt: new Date(),
      playerId: playerId,
      currency: initialBalance.currency,
    });

    // Persiste wallet
    await this.walletRepository.create(wallet);

    if (initialBalance.isPositive) {
      const occurredAt = new Date();
      const transaction = new Transaction({
        id: randomUUIDv7(),
        providerId: 'backend',
        externalId: undefined,
        walletId: wallet.id,
        type: TransactionType.Opening,
        status: TransactionStatus.Processed,
        amount: initialBalance,
        playerId: playerId,
        gameId: undefined,
        roundId: undefined,
        failureCode: undefined,
        referencedId: undefined,
      });

      // Persiste transaction inicial
      await this.transactionRepository.create(transaction);

      // Persiste ledger item
      await this.ledgerItemRepository.create(
        new LedgerItem({
          id: randomUUIDv7(),
          transactionId: transaction.id,
          walletId: wallet.id,
          type: LedgerItemType.Credit,
          balanceBefore: new Money({
            value: new Decimal(0),
            currency: initialBalance.currency,
          }),
          amount: initialBalance,
          balanceAfter: initialBalance,
          createdAt: occurredAt,
        }),
      );

      const event = new WalletBalanceChanged({
        eventId: randomUUIDv7(),
        aggregateId: wallet.id,
        correlationId: transaction.id,
        occurredAt,
        data: {
          walletId: wallet.id,
          transactionId: transaction.id,
          direction: LedgerItemType.Credit,
          money: initialBalance,
          balanceBefore: Money.zero(initialBalance.currency),
          balanceAfter: initialBalance,
          walletVersion: wallet.version,
        },
      });
      await this.outboxMessageRepository.create(
        OutboxMessage.enqueue(randomUUIDv7(), event),
      );
    }

    return wallet;
  }
}
