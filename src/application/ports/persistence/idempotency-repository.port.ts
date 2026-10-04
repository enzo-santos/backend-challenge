/**
 * Consulta e persiste resultados associados a chaves de idempotência.
 *
 * O adaptador pode usar a tabela de transações para atender este contrato; uma
 * tabela física separada não é obrigatória.
 */
export type IdempotencyKey = {
  providerId: string;
  idempotencyKey: string;
};

export type IdempotencyRecord<Output> = {
  key: IdempotencyKey;
  hash: string;
  output: Output;
  createdAt: Date;
};

export interface IdempotencyRepository<Output> {
  /**
   * Recupera o resultado previamente persistido para a chave informada.
   *
   * Usa o hash armazenado para detectar conflito antes de reutilizar o resultado.
   * Por exemplo, a mesma chave com o mesmo hash recupera o resultado anterior;
   * a mesma chave com outro hash não reutiliza esse resultado e caracteriza
   * conflito para a camada de aplicação.
   */
  find(key: IdempotencyKey): Promise<IdempotencyRecord<Output> | undefined>;

  /**
   * Persiste o resultado terminal associado à chave de idempotência.
   *
   * Garante a unicidade da chave no escopo do provider e coordena a operação
   * com a transação que produz o resultado.
   * Por exemplo, uma resposta rejeitada por regra de negócio continua sendo um
   * resultado terminal persistido, enquanto uma referência ainda pendente não é
   * registrada como resultado definitivo.
   */
  save(record: IdempotencyRecord<Output>): Promise<void>;
}
