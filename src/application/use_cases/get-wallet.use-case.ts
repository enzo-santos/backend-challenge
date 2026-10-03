import { Wallet } from '@/src/domain/wallet';
import { UseCase } from '.';
import { WalletRepository } from '../ports/persistence/wallet-repository.port';

type Input = {
  walletId: string;
};

type Args = {
  walletRepository: WalletRepository;
};

export class GetWalletUseCase implements UseCase<Input, Wallet | undefined> {
  private readonly walletRepository: WalletRepository;

  constructor(readonly args: Args) {
    this.walletRepository = args.walletRepository;
  }

  async execute(input: Input): Promise<Wallet | undefined> {
    return await this.walletRepository.read(input.walletId);
  }
}
