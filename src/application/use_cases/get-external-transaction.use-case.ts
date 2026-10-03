import { Transaction } from '@/src/domain/transaction';
import { UseCase, UseCaseNotImplementedError } from '.';
import { TransactionRepository } from '../ports/persistence/transaction-repository.port';

type Input = {
  providerId: string;
  externalTransactionId: string;
};

type Args = {
  transactionRepository: TransactionRepository;
};

export class GetExternalTransactionUseCase implements UseCase<
  Input,
  Transaction | undefined
> {
  private readonly transactionRepository: TransactionRepository;

  constructor(args: Args) {
    this.transactionRepository = args.transactionRepository;
  }

  async execute(input: Input): Promise<Transaction | undefined> {
    return this.transactionRepository.read(
      input.providerId,
      input.externalTransactionId,
    );
  }
}
