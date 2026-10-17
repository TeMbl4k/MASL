import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  /** Closes the connection pool (on app shutdown and in tests). */
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Maximum number of pooled connections. */
  max?: number;
}

/**
 * libpq-only parameters that postgres.js doesn't know. It would pass them to the server as
 * session settings and the connection would fail (Neon adds channel_binding to its URL).
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
    // Keep NOTICEs from CREATE EXTENSION IF NOT EXISTS etc. out of the logs.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return {
    db,
    close: () => client.end({ timeout: 5 }),
  };
}
