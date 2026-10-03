import { Money } from './money';

type WalletArgs = {
  id: string;
  playerId: string;
  balance: Money;
  createdAt: Date;
};

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly balance: Money;
  public readonly createdAt: Date;

  constructor(readonly args: WalletArgs) {
    this.id = args.id;
    this.playerId = args.playerId;
    this.balance = args.balance;
    this.createdAt = args.createdAt;
  }
}
