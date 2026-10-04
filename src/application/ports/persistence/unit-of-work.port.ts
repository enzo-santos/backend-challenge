/**
 * Executa operações de aplicação dentro de uma unidade transacional.
 */
export interface UnitOfWork {
  /**
   * Executa a operação e confirma ou desfaz seus efeitos como uma única unidade.
   *
   * Propaga falhas para impedir a confirmação parcial dos efeitos produzidos
   * durante a operação.
   * Por exemplo, a atualização da carteira, o lançamento no ledger, a transação
   * e a mensagem de outbox são confirmados juntos ou todos desfeitos quando um
   * deles falha.
   */
  execute<Output>(operation: () => Promise<Output>): Promise<Output>;
}
