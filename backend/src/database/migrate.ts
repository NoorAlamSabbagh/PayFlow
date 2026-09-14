import fs from 'fs';
import path from 'path';
import { pool } from './index';
import { logger } from '../config/logger';

async function runMigrations(): Promise<void> {
  logger.info('Starting PayFlow database migration runner...');

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    logger.info(`Executing migration: ${file}`);
    const sql = fs.readFileSync(filePath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      logger.info(`Migration ${file} executed successfully.`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration ${file} failed:`, { error: (err as Error).message });
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info('All database migrations completed successfully.');
  await pool.end();
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export { runMigrations };
