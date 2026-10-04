import { InboxMessage } from '@/src/domain/inbox-message';

export type InboxMessageClaim =
  | {
      type: 'acquired';
      message: InboxMessage;
    }
  | {
      type: 'already_processed';
      message: InboxMessage;
    }
  | {
      type: 'payload_conflict';
      message: InboxMessage;
    };

/**
 * Registra o recebimento de mensagens e controla seu processamento.
 */
export interface InboxMessageRepository {
  /**
   * Adquire a mensagem para processamento ou informa seu estado anterior.
   *
   * Faz a aquisição de forma atômica pela combinação de consumidor e
   * identificador da mensagem, distinguindo reprocessamento e conflito de payload.
   * Por exemplo, a mesma mensagem recebida novamente com o mesmo payload retorna
   * `already_processed`; o mesmo identificador com outro payload retorna
   * `payload_conflict` e não inicia um segundo processamento.
   */
  claim(message: InboxMessage): Promise<InboxMessageClaim>;

  /**
   * Persiste o estado atualizado da mensagem recebida.
   */
  save(message: InboxMessage): Promise<void>;
}
