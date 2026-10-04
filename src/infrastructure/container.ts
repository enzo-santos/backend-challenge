import { SQSClient } from '@aws-sdk/client-sqs';
import Decimal from 'decimal.js';
import { Money } from '@/src/domain/money';
import { TransactionType } from '@/src/domain/transaction';
import { ProcessTransactionOutput } from '@/src/application/use_cases/process-transaction.use-case';
import { CreateWalletUseCase } from '@/src/application/use_cases/create-wallet.use-case';
import { GetExternalTransactionUseCase } from '@/src/application/use_cases/get-external-transaction.use-case';
import { GetTransactionUseCase } from '@/src/application/use_cases/get-transaction.use-case';
import { GetWalletUseCase } from '@/src/application/use_cases/get-wallet.use-case';
import { IdempotentProcessTransactionUseCase } from '@/src/application/use_cases/idempotent-process-transaction.use-case';
import { ListWalletLedgerUseCase } from '@/src/application/use_cases/list-wallet-ledger.use-case';
import { ProcessPendingReferencesUseCase } from '@/src/application/use_cases/process-pending-references.use-case';
import { ProcessInboxMessageUseCase } from '@/src/application/use_cases/process-inbox-message.use-case';
import { ProcessTransactionUseCase } from '@/src/application/use_cases/process-transaction.use-case';
import { PublishOutboxMessagesUseCase } from '@/src/application/use_cases/publish-outbox-messages.use-case';
import { ReconcileWalletUseCase } from '@/src/application/use_cases/reconcile-wallet.use-case';
import { PostgresIdempotencyRepository } from './persistence/postgres/postgres-idempotency.repository';
import { PostgresInboxMessageRepository } from './persistence/postgres/postgres-inbox.repository';
import { PostgresLedgerItemRepository } from './persistence/postgres/postgres-ledger-item.repository';
import { PostgresOutboxMessageRepository } from './persistence/postgres/postgres-outbox.repository';
import {
  PostgresSession,
  PostgresUnitOfWork,
} from './persistence/postgres/postgres-session';
import { PostgresTransactionRepository } from './persistence/postgres/postgres-transaction.repository';
import { createPostgresPool } from './persistence/postgres/create-postgres-pool';
import { PostgresWalletRepository } from './persistence/postgres/postgres-wallet.repository';
import { SqsOutboxMessagePublisher } from './messaging/sqs-outbox-message-publisher';
import { SqsInboxConsumer } from './messaging/sqs-inbox-consumer';

type WagerTransactionRequestedMessage = {
  messageId?: string;
  type: 'WagerTransactionRequested';
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
};

export function createApplicationInfrastructure() {
  const pool = createPostgresPool();
  const session = new PostgresSession(pool);
  const unitOfWork = new PostgresUnitOfWork(pool, session);
  const walletRepository = new PostgresWalletRepository(session);
  const transactionRepository = new PostgresTransactionRepository(session);
  const ledgerItemRepository = new PostgresLedgerItemRepository(session);
  const outboxMessageRepository = new PostgresOutboxMessageRepository(session);
  const inboxMessageRepository = new PostgresInboxMessageRepository(session);
  const idempotencyRepository =
    new PostgresIdempotencyRepository<ProcessTransactionOutput>(
      session,
      deserializeProcessTransactionOutput,
    );
  const sqsClient = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL,
  });
  const outboxPublisher = new SqsOutboxMessagePublisher(
    sqsClient,
    requiredEnvironment('SQS_OUTBOX_QUEUE_URL'),
  );
  const processTransaction = new ProcessTransactionUseCase({
    walletRepository,
    transactionRepository,
    ledgerItemRepository,
    outboxMessageRepository,
    unitOfWork,
  });
  const idempotentProcessTransaction = new IdempotentProcessTransactionUseCase({
    useCase: (input) => processTransaction.execute(input),
    idempotencyRepository,
    unitOfWork,
  });
  const processInboxMessage =
    new ProcessInboxMessageUseCase<WagerTransactionRequestedMessage>({
      inboxMessageRepository,
      unitOfWork,
      processMessage: async (message) =>
        idempotentProcessTransaction.execute({
          providerId: message.data.providerId,
          externalId: message.data.externalTransactionId,
          walletId: message.data.walletId,
          type: transactionType(message.data.kind),
          amount: new Money({
            value: new Decimal(message.data.money.amount),
            currency: message.data.money.currency,
          }),
          playerId: message.data.playerId,
          roundId: message.data.roundId,
          gameId: message.data.gameId,
          referencedId: message.data.referenceExternalTransactionId,
          idempotencyKey: message.data.idempotencyKey,
        }),
    });

  return {
    pool,
    sqsClient,
    unitOfWork,
    walletRepository,
    transactionRepository,
    ledgerItemRepository,
    outboxMessageRepository,
    inboxMessageRepository,
    idempotencyRepository,
    processTransaction,
    idempotentProcessTransaction,
    createWallet: new CreateWalletUseCase({
      walletRepository,
      transactionRepository,
      ledgerItemRepository,
      outboxMessageRepository,
      unitOfWork,
    }),
    getWallet: new GetWalletUseCase({ walletRepository }),
    getTransaction: new GetTransactionUseCase({ transactionRepository }),
    getExternalTransaction: new GetExternalTransactionUseCase({
      transactionRepository,
    }),
    listWalletLedger: new ListWalletLedgerUseCase({
      walletRepository,
      ledgerItemRepository,
    }),
    reconcileWallet: new ReconcileWalletUseCase({
      walletRepository,
      ledgerItemRepository,
    }),
    processPendingReferences: new ProcessPendingReferencesUseCase({
      transactionRepository,
      processTransactionUseCase: (input) => processTransaction.execute(input),
      outboxMessageRepository,
      unitOfWork,
    }),
    publishOutboxMessages: new PublishOutboxMessagesUseCase({
      outboxMessageRepository,
      outboxMessagePublisher: outboxPublisher,
    }),
    inboxConsumer: new SqsInboxConsumer({
      client: sqsClient,
      queueUrl: requiredEnvironment('SQS_INBOX_QUEUE_URL'),
      consumerName: 'wager-transaction-processor',
      processInboxMessage,
    }),
  };
}

function transactionType(
  kind: WagerTransactionRequestedMessage['data']['kind'],
): TransactionType {
  return kind as TransactionType;
}

function deserializeProcessTransactionOutput(
  value: unknown,
): ProcessTransactionOutput {
  const output = value as {
    id: string;
    status: ProcessTransactionOutput['status'];
    balance: { amount: string; currency: string };
    failureCode?: string;
  };
  return {
    id: output.id,
    status: output.status,
    balance: new Money({
      value: new Decimal(output.balance.amount),
      currency: output.balance.currency,
    }),
    failureCode: output.failureCode,
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value == null || value.trim() === '') {
    throw new Error(`missing environment variable: ${name}`);
  }
  return value;
}
