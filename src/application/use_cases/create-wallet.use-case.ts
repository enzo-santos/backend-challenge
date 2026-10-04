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

type Input = {
  playerId: string;
  initialBalance: Money;
};

type Args = {
  walletRepository: WalletRepository;
  transactionRepository: TransactionRepository;
  ledgerItemRepository: LedgerItemRepository;
};

export class CreateWalletUseCase implements UseCase<Input, Wallet> {
  private readonly walletRepository: WalletRepository;
  private readonly transactionRepository: TransactionRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;

  constructor(readonly args: Args) {
    this.walletRepository = args.walletRepository;
    this.transactionRepository = args.transactionRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
  }

  async execute(input: Input): Promise<Wallet> {
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
          createdAt: new Date(),
        }),
      );
    }

    return wallet;
  }
}
