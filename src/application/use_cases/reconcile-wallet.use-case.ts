import { Money } from '@/src/domain/money';
import { UseCase } from '.';
import { WalletRepository } from '../ports/persistence/wallet-repository.port';
import { LedgerItemRepository } from '../ports/persistence/ledger-item-repository.port';
import { LedgerItemType } from '@/src/domain/ledger-item';

type Input = {
  walletId: string;
};

type Output =
  | {
      type: 'success';
      data: {
        walletId: string;
        storedBalance: Money;
        calculatedBalance: Money;
        difference: Money;
        consistent: boolean;
        checkedEntries: number;
      };
    }
  | { type: 'failure'; code: 'WALLET_NOT_FOUND' };

type Mismatch = {
  itemId: string;
  reason:
    | 'MISMATCHED_WALLET'
    | 'MISMATCHED_CURRENCY'
    | 'MISMATCHED_BALANCE'
    | 'MISMATCHED_BALANCE_WINDOW';
};

type Args = {
  walletRepository: WalletRepository;
  ledgerItemRepository: LedgerItemRepository;
};

export class ReconcileWalletUseCase implements UseCase<Input, Output> {
  private readonly walletRepository: WalletRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;

  constructor(args: Args) {
    this.walletRepository = args.walletRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
  }

  async execute(input: Input): Promise<Output> {
    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      return { type: 'failure', code: 'WALLET_NOT_FOUND' };
    }
    const expectedBalance = wallet.balance;

    const ledgerItems = [
      ...(await this.ledgerItemRepository.readAll(input.walletId)),
    ].sort((li0, li1) => {
      const byDate = li0.createdAt.getTime() - li1.createdAt.getTime();
      if (byDate !== 0) {
        return byDate;
      }
      return li0.id.localeCompare(li1.id);
    });

    const mismatches: Mismatch[] = [];
    let currentBalance = Money.zero(expectedBalance.currency);
    for (const ledgerItem of ledgerItems) {
      if (ledgerItem.walletId !== input.walletId) {
        mismatches.push({
          itemId: ledgerItem.id,
          reason: 'MISMATCHED_WALLET',
        });
        continue;
      }
      if (
        ledgerItem.amount.currency !== expectedBalance.currency ||
        ledgerItem.balanceBefore.currency !== expectedBalance.currency ||
        ledgerItem.balanceAfter.currency !== expectedBalance.currency
      ) {
        mismatches.push({
          itemId: ledgerItem.id,
          reason: 'MISMATCHED_CURRENCY',
        });
        continue;
      }
      if (!ledgerItem.balanceBefore.equals(currentBalance)) {
        mismatches.push({
          itemId: ledgerItem.id,
          reason: 'MISMATCHED_BALANCE_WINDOW',
        });
        continue;
      }

      switch (ledgerItem.type) {
        case LedgerItemType.Credit:
          {
            const expectedBalanceAfter = ledgerItem.balanceBefore.add(
              ledgerItem.amount,
            );
            if (!expectedBalanceAfter.equals(ledgerItem.balanceAfter)) {
              mismatches.push({
                itemId: ledgerItem.id,
                reason: 'MISMATCHED_BALANCE',
              });
            }
            currentBalance = currentBalance.add(ledgerItem.amount);
          }
          break;
        case LedgerItemType.Debit:
          {
            const expectedBalanceAfter = ledgerItem.balanceBefore.subtract(
              ledgerItem.amount,
            );
            if (!expectedBalanceAfter.equals(ledgerItem.balanceAfter)) {
              mismatches.push({
                itemId: ledgerItem.id,
                reason: 'MISMATCHED_BALANCE',
              });
            }
            currentBalance = currentBalance.subtract(ledgerItem.amount);
          }
          break;
      }
    }

    const difference = expectedBalance.subtract(currentBalance);
    // TODO Registrar log e métrica se houver divergência
    return {
      type: 'success',
      data: {
        walletId: input.walletId,
        storedBalance: expectedBalance,
        calculatedBalance: currentBalance,
        difference: difference,
        consistent: mismatches.length === 0 && difference.isZero,
        checkedEntries: ledgerItems.length,
      },
    };
  }
}
