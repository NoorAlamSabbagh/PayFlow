import fs from 'fs';
import path from 'path';
import { pool } from './index';
import { logger } from '../config/logger';

async function runMigrations(): Promise<void> {
  logger.info('Starting PayFlow database migration runner...');

  const client = await pool.connect();
  try {
    // 1. Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Fetch applied migrations
    const { rows: appliedRows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations;'
    );
    const appliedSet = new Set(appliedRows.map((r) => r.version));

    // Special case: if 001 is not tracked but tables already exist, mark 001 as applied
    if (!appliedSet.has('001_initial_schema.sql')) {
      const { rows: tableCheck } = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'users';"
      );
      if (tableCheck.length > 0) {
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ('001_initial_schema.sql') ON CONFLICT DO NOTHING;"
        );
        appliedSet.add('001_initial_schema.sql');
        logger.info('Recognized existing schema. Marked 001_initial_schema.sql as already applied.');
      }
    }

    // 3. Scan and execute unapplied migrations in order
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        logger.debug(`Migration ${file} already applied, skipping.`);
        continue;
      }

      logger.info(`Executing migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1);',
          [file]
        );
        await client.query('COMMIT');
        logger.info(`Migration ${file} executed successfully.`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Migration ${file} failed:`, { error: (err as Error).message });
        throw err;
      }
    }

    logger.info('All database migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration execution failed:', err);
      process.exit(1);
    });
}

export { runMigrations };
