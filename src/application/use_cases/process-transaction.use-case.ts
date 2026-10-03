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
    const [status, newBalance] = await this.#calculate(transactionId, input);
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
      balance: newBalance,
    };
  }

  async #calculate(
    transactionId: string,
    input: Input,
  ): Promise<[TransactionStatus, Money]> {
    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      throw new Error('wallet not found');
    }

    let newBalance: Money;
    switch (input.type) {
      case TransactionType.Bet:
        newBalance = wallet.balance.subtract(input.amount);

        // Rejeitar se saldo insuficiente
        if (newBalance.isNegative) {
          return [TransactionStatus.Rejected, wallet.balance];
        }

        // Atualiza saldo
        await this.walletRepository.updateBalance(wallet.id, newBalance);
        // Atualiza ledger (1 entrada DEBIT)
        await this.ledgerItemRepository.create(
          new LedgerItem({
            id: randomUUIDv7(),
            transactionId: transactionId,
            type: LedgerItemType.Debit,
            amount: input.amount,
            createdAt: new Date(),
          }),
        );

        return [TransactionStatus.Processed, newBalance];

      case TransactionType.Win:
        newBalance = wallet.balance.add(input.amount);

        // Atualiza saldo
        await this.walletRepository.updateBalance(wallet.id, newBalance);
        // Atualiza ledger (1 entrada CREDIT)
        await this.ledgerItemRepository.create(
          new LedgerItem({
            id: randomUUIDv7(),
            transactionId: transactionId,
            type: LedgerItemType.Credit,
            amount: input.amount,
            createdAt: new Date(),
          }),
        );
        return [TransactionStatus.Processed, newBalance];

      case TransactionType.Loss:
        // Registra o resultado sem mover saldo
        return [TransactionStatus.Processed, wallet.balance];

      case TransactionType.Refund:
      // ...

      case TransactionType.Rollback:
      // ...

      case TransactionType.Opening:
        throw new Error('invalid type');
    }
  }
}
