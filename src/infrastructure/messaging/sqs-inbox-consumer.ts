import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  ProcessInboxMessageInput,
  ProcessInboxMessageUseCase,
} from '@/src/application/use_cases/process-inbox-message.use-case';

type Args<Payload> = {
  client: SQSClient;
  queueUrl: string;
  consumerName: string;
  processInboxMessage: ProcessInboxMessageUseCase<Payload>;
  visibilityTimeoutSeconds?: number;
};

export class SqsInboxConsumer<Payload> {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly consumerName: string;
  private readonly processInboxMessage: ProcessInboxMessageUseCase<Payload>;
  private readonly visibilityTimeoutSeconds: number;

  constructor(args: Args<Payload>) {
    this.client = args.client;
    this.queueUrl = args.queueUrl;
    this.consumerName = args.consumerName;
    this.processInboxMessage = args.processInboxMessage;
    this.visibilityTimeoutSeconds = args.visibilityTimeoutSeconds ?? 30;
  }

  async pollOnce(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) {
      return 0;
    }

    const response = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    const messages = response.Messages ?? [];
    for (const message of messages) {
      await this.processReceivedMessage(message, signal);
    }
    return messages.length;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce(signal);
    }
  }

  private async processReceivedMessage(
    message: {
      MessageId?: string;
      ReceiptHandle?: string;
      Body?: string;
      Attributes?: Record<string, string>;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    if (message.MessageId == null || message.ReceiptHandle == null) {
      return;
    }

    if (message.Body == null) {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    let payload: Payload;
    try {
      payload = JSON.parse(message.Body) as Payload;
    } catch {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    const input: ProcessInboxMessageInput<Payload> = {
      consumerName: this.consumerName,
      messageId: this.payloadMessageId(payload) ?? message.MessageId,
      payload,
      receivedAt: new Date(),
    };

    try {
      const result = await this.processInboxMessage.execute(input);
      if (
        result.type === 'success' ||
        result.code === 'INBOX_PAYLOAD_CONFLICT'
      ) {
        await this.deleteMessage(message.ReceiptHandle);
      }
    } catch {
      if (!signal?.aborted) {
        await this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: this.retryVisibilitySeconds(message),
          }),
        );
      }
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private payloadMessageId(payload: Payload): string | undefined {
    if (
      typeof payload !== 'object' ||
      payload == null ||
      !('messageId' in payload)
    ) {
      return undefined;
    }
    const messageId = payload.messageId;
    return typeof messageId === 'string' && messageId.trim() !== ''
      ? messageId
      : undefined;
  }

  private retryVisibilitySeconds(message: {
    Attributes?: Record<string, string>;
  }): number {
    const attempts = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
    return Math.min(60, Math.max(1, 2 ** Math.min(attempts - 1, 6)));
  }
}
