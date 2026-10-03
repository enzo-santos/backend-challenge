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

  referencedId: string | undefined; // Apenas para REFUND e ROLLBACk
};

type FailureCode =
  | 'insuficcientFunds' // Para saldo insuficiente
  | 'unknownReferencedId' // Para REFUND/ROLLBACK sem referencedId
  | 'invalidReferencedTransactionType' // Para REFUND cujo tipo da transação original não é BET
  | 'invalidReferencedTransactionStatus' // Para REFUND cujo status da transação original não é PROCESSED
  | 'invalidReferencedTransactionProviderId' // Para REFUND cujo providerId da transação original é diferente do atual
  | 'invalidReferencedTransactionWalletId' // Para REFUND cujo walletId da transação original é diferente do atual
  | 'invalidReferencedTransactionAmountCurrency' // Para REFUND cujo amount.currency da transação original é diferente do atual
  | 'invalidReferencedTransactionRoundId' // Para REFUND cujo roundId da transação original é diferente do atual
  | 'invalidReferencedTransactionAmount' // Para REFUND cujo amount da transação original é diferente do atual
  ;

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

    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      throw new Error('wallet not found');
    }

    const output = await this.#calculate(wallet, input);
    let balanceAfter: Money | undefined;
    let status: TransactionStatus;
    let failureCode: string | undefined;
    switch (output.type) {
      case 'processed':
        status = TransactionStatus.Processed;

        if (output.kind != null) {
          switch (output.kind) {
            case LedgerItemType.Credit:
              balanceAfter = wallet.balance.add(input.amount);
              break;
            case LedgerItemType.Debit:
              balanceAfter = wallet.balance.subtract(input.amount);
              break;
          }

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

          // Atualiza saldo
          await this.walletRepository.updateBalance(wallet.id, balanceAfter);
          // Atualiza ledger
          await this.ledgerItemRepository.create(item);
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
      failureCode: failureCode,
    });
    await this.transactionRepository.create(transaction);
    return {
      id: transactionId,
      status: status,
      balance: balanceAfter ?? wallet.balance,
    };
  }

  async #calculate(
    wallet: Wallet,
    input: Input,
  ): Promise<Calculation> {
    switch (input.type) {
      case TransactionType.Bet:
        // Rejeitar se saldo insuficiente
        if (wallet.balance.isLessThan(input.amount)) {
          return {
            type: 'rejected',
            code: 'insuficcientFunds',
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
        const referencedId = input.referencedId;
        if (referencedId == null) {
          return { type: 'rejected', code: 'unknownReferencedId' };
        }
        const transaction = await this.transactionRepository.read(
          input.providerId,
          referencedId,
        );
        if (transaction == null) {
          return { type: 'pending' };
        }
        if (transaction.type !== TransactionType.Bet) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionType',
          };
        }
        if (transaction.status !== TransactionStatus.Processed) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionStatus',
          };
        }
        if (transaction.providerId !== input.providerId) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionProviderId',
          };
        }
        if (transaction.walletId !== input.walletId) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionWalletId',
          };
        }
        if (transaction.amount.currency !== input.amount.currency) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionAmountCurrency',
          };
        }
        if (transaction.roundId !== input.roundId) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionRoundId',
          };
        }
        if (!transaction.amount.equals(input.amount)) {
          return {
            type: 'rejected',
            code: 'invalidReferencedTransactionAmount',
          };
        }
        // TODO Impedir uma segunda reversão da mesma BET
        return { type: 'processed', kind: LedgerItemType.Credit };

      case TransactionType.Rollback:
      // ...

      case TransactionType.Opening:
        throw new Error('invalid type');
    }
  }
}
