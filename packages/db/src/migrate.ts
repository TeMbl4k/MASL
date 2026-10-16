import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

/** SQL migrations directory (sits next to dist/ and src/). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Advisory lock key: any constant shared by all app instances. */
const MIGRATION_LOCK_ID = 7_302_514;

/**
 * Applies migrations. Concurrently started instances wait for each other on an advisory
 * lock; the lock is held per connection, hence a single-connection pool.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, close } = createDb(databaseUrl, { max: 1 });
  try {
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`);
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
    }
  } finally {
    await close();
  }
}
