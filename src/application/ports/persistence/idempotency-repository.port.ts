/**
 * Idempotency view over transaction persistence.
 *
 * The infrastructure adapter may implement this port using the transactions
 * table; this port does not require a separate physical table.
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
  find(key: IdempotencyKey): Promise<IdempotencyRecord<Output> | undefined>;
  save(record: IdempotencyRecord<Output>): Promise<void>;
}
