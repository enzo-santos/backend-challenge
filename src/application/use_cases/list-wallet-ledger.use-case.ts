import { LedgerItem } from '@/src/domain/ledger-item';
import { UseCase } from '.';
import {
  LedgerItemCursor,
  LedgerItemRepository,
} from '../ports/persistence/ledger-item-repository.port';
import { WalletRepository } from '../ports/persistence/wallet-repository.port';

type Input = {
  walletId: string;
  after?: LedgerItemCursor;
  limit?: number;
};

type Output =
  | {
      type: 'success';
      data: {
        walletId: string;
        items: LedgerItem[];
        nextCursor: LedgerItemCursor | undefined;
      };
    }
  | {
      type: 'failure';
      code: 'WALLET_NOT_FOUND' | 'INVALID_LIMIT';
    };

type Args = {
  walletRepository: WalletRepository;
  ledgerItemRepository: LedgerItemRepository;
};

export class ListWalletLedgerUseCase implements UseCase<Input, Output> {
  private readonly walletRepository: WalletRepository;
  private readonly ledgerItemRepository: LedgerItemRepository;

  constructor(readonly args: Args) {
    this.walletRepository = args.walletRepository;
    this.ledgerItemRepository = args.ledgerItemRepository;
  }

  async execute(input: Input): Promise<Output> {
    const limit = input.limit ?? 50;
    if (limit < 1 || limit > 100) {
      return { type: 'failure', code: 'INVALID_LIMIT' };
    }

    const wallet = await this.walletRepository.read(input.walletId);
    if (wallet == null) {
      return { type: 'failure', code: 'WALLET_NOT_FOUND' };
    }

    const page = await this.ledgerItemRepository.readPage(input.walletId, {
      limit,
      after: input.after,
    });
    const lastItem = page.items.at(-1);

    return {
      type: 'success',
      data: {
        walletId: wallet.id,
        items: page.items,
        nextCursor:
          page.hasNextPage && lastItem != null
            ? { createdAt: lastItem.createdAt, id: lastItem.id }
            : undefined,
      },
    };
  }
}
