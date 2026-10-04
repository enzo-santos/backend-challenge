import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { UnitOfWork } from '@/src/application/ports/persistence/unit-of-work.port';

export class PostgresSession {
  private readonly transaction: AsyncLocalStorage<PoolClient>;

  constructor(private readonly pool: Pool) {
    this.transaction = new AsyncLocalStorage<PoolClient>();
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    const client = this.transaction.getStore();
    if (client != null) {
      return client.query<Row>(text, values as unknown[]);
    }
    return this.pool.query<Row>(text, values as unknown[]);
  }

  async withTransaction<Output>(
    client: PoolClient,
    operation: () => Promise<Output>,
  ): Promise<Output> {
    return this.transaction.run(client, operation);
  }

  isInTransaction(): boolean {
    return this.transaction.getStore() != null;
  }

  currentClient(): PoolClient {
    const client = this.transaction.getStore();
    if (client == null) {
      throw new Error('postgres transaction is not active');
    }
    return client;
  }
}

export class PostgresUnitOfWork implements UnitOfWork {
  private savepointSequence = 0;

  constructor(
    private readonly pool: Pool,
    private readonly session: PostgresSession,
  ) {}

  async execute<Output>(operation: () => Promise<Output>): Promise<Output> {
    if (this.session.isInTransaction()) {
      const savepoint = `sp_${++this.savepointSequence}`;
      const client = this.session.currentClient();
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const output = await operation();
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return output;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const output = await this.session.withTransaction(client, operation);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
