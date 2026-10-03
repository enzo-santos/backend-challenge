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

type Input = {
  providerId: string;
  externalId: string;
  walletId: string;
  type: TransactionType;
  amount: Money;

  roundId: string;
  gameId: string;
};

export type ProcessTransactionResult = {
  id: string;
  status: TransactionStatus;
  balance: Money;
};

type Args = {
  walletRepository: WalletRepository;
  transactionRepository: TransactionRepository;
  ledgerItemRepository: LedgerItemRepository;
};

export class ProcessTransactionUseCase implements UseCase<
  Input,
  ProcessTransactionResult
> {
  private readonly walletRepository: WalletRepository;
  private readonly transactionRepository: TransactionRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;

  constructor(args: Args) {
    this.walletRepository = args.walletRepository;
    this.transactionRepository = args.transactionRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
  }

  async execute(input: Input): Promise<ProcessTransactionResult> {
    const transactionId = randomUUIDv7();
    const [wallet, item] = await this.#calculate(transactionId, input);
    if (item != null) {
      let balanceAfter: Money;
      switch (item.type) {
        case LedgerItemType.Credit:
          balanceAfter = item.balanceBefore.add(item.amount);
          break;
        case LedgerItemType.Debit:
          balanceAfter = item.balanceBefore.subtract(item.amount);
          break;
      }
      if (!item.balanceAfter.equals(balanceAfter)) {
        throw new Error(
          `failed to validate balanceAfter: expected ${balanceAfter}, got ${item.balanceAfter}`,
        );
      }

      // Atualiza saldo
      await this.walletRepository.updateBalance(wallet.id, balanceAfter);
      // Atualiza ledger
      await this.ledgerItemRepository.create(item);
    }

    const status =
      item === undefined
        ? TransactionStatus.Rejected
        : TransactionStatus.Processed;
    const transaction = new Transaction({
      id: transactionId,
      walletId: input.walletId,
      providerId: input.providerId,
      externalId: input.externalId,
      amount: input.amount,
      type: input.type,
      status: status,
      gameId: input.gameId,
      roundId: input.roundId,
    });
    await this.transactionRepository.create(transaction);
    return {
      id: transactionId,
      status: status,
      balance: item?.balanceAfter ?? wallet.balance,
    };
  }

  async #calculate(
    transactionId: string,
    input: Input,
  ): Promise<[Wallet, LedgerItem | undefined | null]> {
    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      throw new Error('wallet not found');
    }

    switch (input.type) {
      case TransactionType.Bet:
        // Rejeitar se saldo insuficiente
        if (wallet.balance.isLessThan(input.amount)) {
          return [wallet, undefined];
        }
        return [
          wallet,
          new LedgerItem({
            id: randomUUIDv7(),
            transactionId: transactionId,
            walletId: wallet.id,
            type: LedgerItemType.Debit,
            balanceBefore: wallet.balance,
            amount: input.amount,
            balanceAfter: wallet.balance.subtract(input.amount),
            createdAt: new Date(),
          }),
        ];

      case TransactionType.Win:
        return [
          wallet,
          new LedgerItem({
            id: randomUUIDv7(),
            transactionId: transactionId,
            walletId: wallet.id,
            type: LedgerItemType.Credit,
            balanceBefore: wallet.balance,
            amount: input.amount,
            balanceAfter: wallet.balance.add(input.amount),
            createdAt: new Date(),
          }),
        ];

      case TransactionType.Loss:
        // Registra o resultado sem mover saldo
        return [wallet, null];

      case TransactionType.Refund:
      // ...

      case TransactionType.Rollback:
      // ...

      case TransactionType.Opening:
        throw new Error('invalid type');
    }
  }
}
