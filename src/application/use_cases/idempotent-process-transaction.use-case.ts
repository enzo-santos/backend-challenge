import { createHash } from 'node:crypto';
import stringify from 'fast-json-stable-stringify';
import type { UseCase } from '.';
import type { IdempotencyKey } from '../ports/persistence/idempotency-repository.port';
import type { IdempotencyRepository } from '../ports/persistence/idempotency-repository.port';
import { TransactionStatus } from '@/src/domain/transaction';
import type { ProcessTransactionInput } from './process-transaction.use-case';
import type { UnitOfWork } from '../ports/persistence/unit-of-work.port';

export type Input<I> = I & { idempotencyKey: string };

type Output<O> =
  | {
      type: 'success';
      data: O;
      idempotentReplay: boolean;
    }
  | {
      type: 'failure';
      code: 'IDEMPOTENCY_KEY_REQUIRED' | 'IDEMPOTENCY_CONFLICT';
    };

type Args<I, O> = {
  useCase: (input: I) => Promise<O>;
  idempotencyRepository: IdempotencyRepository<O>;
  unitOfWork: UnitOfWork;
};

export class IdempotentProcessTransactionUseCase<
  I extends ProcessTransactionInput,
  O extends { status: TransactionStatus },
> implements UseCase<Input<I>, Output<O>> {
  private readonly useCase: (input: I) => Promise<O>;
  private readonly idempotencyRepository: IdempotencyRepository<O>;
  private readonly unitOfWork: UnitOfWork;

  constructor(args: Args<I, O>) {
    this.useCase = args.useCase;
    this.idempotencyRepository = args.idempotencyRepository;
    this.unitOfWork = args.unitOfWork;
  }

  async execute(input: Input<I>): Promise<Output<O>> {
    return this.unitOfWork.execute(() => this.executeWithinTransaction(input));
  }

  private async executeWithinTransaction(input: Input<I>): Promise<Output<O>> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey === '') {
      return {
        type: 'failure',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      };
    }

    const key: IdempotencyKey = {
      providerId: input.providerId,
      idempotencyKey,
    };
    const hash = this.createPayloadHash(input);

    const existing = await this.idempotencyRepository.find(key);
    if (existing != null) {
      if (existing.hash !== hash) {
        return {
          type: 'failure',
          code: 'IDEMPOTENCY_CONFLICT',
        };
      }

      return {
        type: 'success',
        data: existing.output,
        idempotentReplay: true,
      };
    }

    const result = await this.useCase({
      ...input,
      payloadHash: hash,
    });

    const output: Output<O> = {
      type: 'success',
      data: result,
      idempotentReplay: false,
    };

    if (result.status !== TransactionStatus.PendingReference) {
      await this.idempotencyRepository.save({
        key,
        hash,
        output: result,
        createdAt: new Date(),
      });
    }
    return output;
  }

  private createPayloadHash(input: I): string {
    const canonicalPayload = stringify({
      providerId: input.providerId,
      externalId: input.externalId,
      walletId: input.walletId,
      type: input.type,
      amount: {
        value: input.amount.args.value.toString(),
        currency: input.amount.currency,
      },
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      referencedId: input.referencedId ?? null,
    });

    return createHash('sha256').update(canonicalPayload).digest('hex');
  }
}
