import { OutboxMessage } from '@/src/domain/outbox-message';

/**
 * Persiste mensagens de integração até que sejam publicadas com sucesso.
 */
export interface OutboxMessageRepository {
  /**
   * Persiste uma mensagem pendente para publicação posterior.
   */
  create(message: OutboxMessage): Promise<void>;

  /**
   * Adquire mensagens vencidas para publicação durante uma janela de lease.
   *
   * Faz a aquisição de forma segura para permitir múltiplos publicadores sem
   * entregar simultaneamente a mesma mensagem para processamento concorrente.
   * Por exemplo, quando dois workers consultam a mesma mensagem vencida, apenas
   * um recebe a mensagem durante o lease atual; se ele não concluir a tentativa,
   * ela volta a ficar elegível após o vencimento do lease.
   */
  claimDue(options: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<OutboxMessage[]>;

  /**
   * Persiste o novo estado da mensagem após uma tentativa de publicação.
   *
   * Mantém a mensagem para novas tentativas ou auditoria, em vez de removê-la
   * automaticamente após uma tentativa.
   * Por exemplo, uma publicação bem-sucedida registra o estado publicado, uma
   * falha transitória agenda nova tentativa e uma falha permanente permanece
   * disponível para diagnóstico sem ser silenciosamente descartada.
   */
  save(message: OutboxMessage): Promise<void>;
}
