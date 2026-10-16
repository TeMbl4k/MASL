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

/**
 * Параметры libpq, которых нет в postgres.js. Он передал бы их серверу как настройки
 * сессии, и подключение упало бы (Neon добавляет channel_binding в строку подключения).
 */
const LIBPQ_ONLY_PARAMS = ['channel_binding'];

export function normalizeDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  for (const param of LIBPQ_ONLY_PARAMS) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): DbHandle {
  const client = postgres(normalizeDatabaseUrl(databaseUrl), {
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
