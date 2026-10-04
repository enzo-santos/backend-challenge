import { LedgerItem } from '@/src/domain/ledger-item';

export type LedgerItemCursor = {
  createdAt: Date;
  id: string;
};

export type LedgerItemPage = {
  items: LedgerItem[];
  hasNextPage: boolean;
};

/**
 * Persiste e consulta os lançamentos imutáveis de uma carteira.
 */
export interface LedgerItemRepository {
  /**
   * Persiste um lançamento financeiro sem permitir alteração posterior de seus valores.
   */
  create(item: LedgerItem): Promise<void>;

  /**
   * Lê todos os lançamentos da carteira para operações que exigem o histórico completo.
   */
  readAll(walletId: string): Promise<LedgerItem[]>;

  /**
   * Lê uma página ordenada de lançamentos a partir do cursor informado.
   *
   * Aplica a ordenação e o limite na persistência, considerando estritamente
   * posteriores ao par `(createdAt, id)` representado pelo cursor.
   * Por exemplo, se a última entrada da página anterior tem uma determinada
   * data e identificador, a próxima página começa depois dessa combinação,
   * mesmo quando outras entradas compartilham a mesma data.
   */
  readPage(
    walletId: string,
    options: {
      limit: number;
      after?: LedgerItemCursor;
    },
  ): Promise<LedgerItemPage>;
}
