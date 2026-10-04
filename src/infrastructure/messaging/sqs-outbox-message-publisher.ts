import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { OutboxMessage } from '@/src/domain/outbox-message';
import {
  OutboxMessagePublisher,
  PublishOutboxMessageResult,
} from '@/src/application/ports/messaging/outbox-message-publisher.port';

export class SqsOutboxMessagePublisher implements OutboxMessagePublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: OutboxMessage): Promise<PublishOutboxMessageResult> {
    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(message.payload),
          MessageGroupId: message.aggregateId,
          MessageDeduplicationId: message.id,
          MessageAttributes: {
            eventType: {
              DataType: 'String',
              StringValue: message.eventType,
            },
          },
        }),
      );
      return { type: 'published' };
    } catch (error) {
      const code = this.failureCode(error);
      return {
        type: 'failure',
        retryable: !this.isPermanent(code),
        code,
      };
    }
  }

  private failureCode(error: unknown): string {
    if (typeof error === 'object' && error != null && '$metadata' in error) {
      const metadata = error.$metadata;
      if (
        typeof metadata === 'object' &&
        metadata != null &&
        'httpStatusCode' in metadata
      ) {
        return `SQS_HTTP_${String(metadata.httpStatusCode)}`;
      }
    }
    if (error instanceof Error && error.name.length > 0) {
      return `SQS_${error.name}`;
    }
    return 'SQS_PUBLISH_FAILED';
  }

  private isPermanent(code: string): boolean {
    return (
      code.includes('Invalid') ||
      code.includes('AccessDenied') ||
      code.includes('NonExistentQueue') ||
      code === 'SQS_HTTP_400' ||
      code === 'SQS_HTTP_403' ||
      code === 'SQS_HTTP_404'
    );
  }
}
