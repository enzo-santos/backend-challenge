import { Wallet } from '@/src/domain/wallet';

/**
 * Persiste e consulta carteiras por sua identidade e moeda.
 */
export interface WalletRepository {
  /**
   * Verifica se o jogador já possui uma carteira na moeda informada.
   */
  exists(playerId: string, currency: string): Promise<boolean>;

  /**
   * Persiste uma nova carteira.
   */
  create(wallet: Wallet): Promise<void>;

  /**
   * Lê uma carteira pelo seu identificador.
   */
  read(id: string): Promise<Wallet | undefined>;

  /**
   * Persiste o novo saldo e a nova versão da carteira.
   *
   * Detecta versões concorrentes e sinaliza a falha com `ConcurrencyConflictError`.
   * Por exemplo, se dois workers leem a mesma versão e um deles salva primeiro,
   * o segundo encontra uma versão antiga e falha sem sobrescrever o novo saldo.
   */
  update(wallet: Wallet): Promise<void>;
}
