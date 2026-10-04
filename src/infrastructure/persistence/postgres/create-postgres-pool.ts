import { Pool, PoolConfig } from 'pg';

export function createPostgresPool(
  config: PoolConfig = {
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  },
): Pool {
  return new Pool(config);
}
