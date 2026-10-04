import { Wallet } from '@/src/domain/wallet';

export interface WalletRepository {
  exists(playerId: string, currency: string): Promise<boolean>;
  create(wallet: Wallet): Promise<void>;
  read(id: string): Promise<Wallet | undefined>;
  update(wallet: Wallet): Promise<void>;
}
