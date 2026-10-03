import { Money } from "@/src/domain/money";
import { UseCase } from ".";
import { Wallet } from "@/src/domain/wallet";
import { randomUUIDv7 } from "bun";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

export class CreateWalletUseCase
  implements UseCase<CreateWalletInput, Wallet>
{
  async execute(input: CreateWalletInput): Promise<Wallet> {
    return new Wallet({
      id: randomUUIDv7(),
      balance: input.initialBalance,
      createdAt: new Date(),
      playerId: input.playerId,
    })
  }
}
