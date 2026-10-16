import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { runMigrations } from './migrate.js';

export interface TestDatabase {
  url: string;
  drop: () => Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** false — оставить базу пустой, без миграций. */
  migrate?: boolean;
}

/**
 * Создаёт отдельную временную базу с применёнными миграциями.
 * adminUrl — строка подключения к серверу с правом CREATE DATABASE
 * (локально: docker compose, в CI: сервис postgis).
 */
export async function createTestDatabase(
  adminUrl: string,
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const name = `masl_test_${randomBytes(6).toString('hex')}`;
  await runAsAdmin(adminUrl, `CREATE DATABASE ${name}`);
  const drop = () => runAsAdmin(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  try {
    if (options.migrate !== false) {
      await runMigrations(url.toString());
    }
  } catch (error) {
    await drop();
    throw error;
  }

  return { url: url.toString(), drop };
}

async function runAsAdmin(adminUrl: string, statement: string): Promise<void> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end({ timeout: 5 });
  }
}
