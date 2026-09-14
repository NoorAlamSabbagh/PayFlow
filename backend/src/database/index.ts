import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../config/logger';

export const pool = new Pool(
  config.database.url
    ? {
        connectionString: config.database.url,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      }
    : {
        host: config.database.host,
        port: config.database.port,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
        max: config.database.max,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis,
      }
);

pool.on('connect', () => {
  logger.debug('New client connected to PostgreSQL pool');
});

pool.on('error', (err: Error) => {
  logger.error('Unexpected error on idle PostgreSQL client', { error: err.message, stack: err.stack });
});

/**
 * Execute a parameterized query using the pool
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('Database query failed', { text, duration, error: (err as Error).message });
    throw err;
  }
}

/**
 * Acquire a dedicated client for multi-statement ACID transactions
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Health check to verify database connectivity
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 AS alive');
    return res.rows.length > 0;
  } catch (err) {
    logger.error('PostgreSQL health check failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Graceful shutdown hook
 */
export async function closeDatabase(): Promise<void> {
  logger.info('Closing PostgreSQL connection pool...');
  await pool.end();
  logger.info('PostgreSQL connection pool closed');
}
