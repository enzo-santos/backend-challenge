import { Money } from './money';

type Args = {
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

  constructor(readonly args: Args) {
    this.id = args.id;
    this.playerId = args.playerId;
    this.balance = args.balance;
    this.createdAt = args.createdAt;
  }
}
