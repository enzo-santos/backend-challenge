import { OutboxMessage } from '@/src/domain/outbox-message';

export type PublishOutboxMessageResult =
  | { type: 'published' }
  | {
      type: 'failure';
      retryable: boolean;
      code: string;
    };

/**
 * Publica mensagens de integração e classifica o resultado da tentativa.
 */
export interface OutboxMessagePublisher {
  /**
   * Publica a mensagem e indica se uma nova tentativa é apropriada em caso de falha.
   *
   * Por exemplo, uma indisponibilidade temporária ou um timeout normalmente
   * resulta em `retryable: true`, enquanto credenciais inválidas ou um payload
   * rejeitado pelo broker resultam em `retryable: false`.
   */
  publish(message: OutboxMessage): Promise<PublishOutboxMessageResult>;
}
