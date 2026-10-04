import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@/src/domain/transaction';

export type PendingReferenceTransaction = {
  transaction: Transaction;
  attempts: number;
};

/**
 * Persiste e consulta transações financeiras e seus estados de processamento.
 */
export interface TransactionRepository {
  /**
   * Persiste uma nova transação e suas identidades externas.
   */
  create(transaction: Transaction): Promise<void>;

  /**
   * Persiste as alterações de uma transação já existente.
   */
  update(transaction: Transaction): Promise<void>;

  /**
   * Persiste a alteração somente se a transação ainda estiver no estado esperado.
   *
   * Retorna `false` quando outro processamento já tiver alterado o estado.
   * Por exemplo, dois workers que leem a mesma transação pendente podem tentar
   * concluí-la, mas somente o primeiro que ainda encontra o estado esperado
   * efetiva a alteração.
   */
  updateIfStatus(
    transaction: Transaction,
    expectedStatus: TransactionStatus,
  ): Promise<boolean>;

  /**
   * Lê uma transação pelo seu identificador interno.
   */
  read(id: string): Promise<Transaction | undefined>;

  /**
   * Lê uma transação pela identidade fornecida pelo provider.
   */
  read(
    providerId: string,
    externalId: string,
  ): Promise<Transaction | undefined>;

  /**
   * Verifica se uma operação do tipo informado já foi aplicada para a transação externa.
   */
  checkApplied(
    providerId: string,
    externalId: string,
    type: TransactionType,
  ): Promise<boolean>;

  /**
   * Lê transações com referência pendente que já podem ser tentadas novamente.
   * Por exemplo, uma transação cuja próxima tentativa está agendada para o
   * futuro não aparece até que o horário informado torne a tentativa elegível.
   */
  readPendingReferences(options: {
    limit: number;
    now: Date;
  }): Promise<PendingReferenceTransaction[]>;

  /**
   * Agenda a próxima tentativa de resolução da referência pendente.
   * Por exemplo, uma referência ausente temporariamente mantém a transação
   * pendente e registra um próximo horário de tentativa em vez de rejeitá-la.
   */
  schedulePendingReferenceRetry(
    transactionId: string,
    nextAttemptAt: Date,
  ): Promise<void>;

  /**
   * Rejeita definitivamente uma transação que não conseguiu resolver sua referência.
   *
   * A transição só é válida enquanto a transação permanecer pendente e deve
   * devolver a transação já atualizada.
   * Por exemplo, depois do limite de tentativas, a transação passa a rejeitada
   * com um código estável; se outro worker já a resolveu, a operação não a
   * rejeita novamente.
   */
  rejectPendingReference(
    transactionId: string,
    failureCode: string,
  ): Promise<Transaction>;
}
