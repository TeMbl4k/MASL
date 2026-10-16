import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

/** Каталог с SQL-миграциями (лежит рядом с dist/ и src/). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Ключ advisory lock: любое постоянное число, общее для всех экземпляров приложения. */
const MIGRATION_LOCK_ID = 7_302_514;

/**
 * Применяет миграции. Если запущено несколько экземпляров сразу, они ждут друг друга
 * на advisory lock: блокировка держится на соединении, поэтому пул из одного соединения.
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
