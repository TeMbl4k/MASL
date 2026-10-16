import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  /** Закрывает пул соединений (при остановке приложения и в тестах). */
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Максимум соединений в пуле. */
  max?: number;
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    // Не засоряем логи NOTICE от CREATE EXTENSION IF NOT EXISTS и т.п.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return {
    db,
    close: () => client.end({ timeout: 5 }),
  };
}
