import { setTimeout as sleep } from 'node:timers/promises';
import { runMigrations } from '../migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

/**
 * Ошибки, когда база ещё поднимается или её адрес ещё не резолвится (первый деплой).
 * Drizzle заворачивает ошибку драйвера в DrizzleQueryError, код лежит в cause.
 */
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  '57P03', // the database system is starting up
]);

function errorCode(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

const ATTEMPTS = 30;
const DELAY_MS = 2000;

for (let attempt = 1; ; attempt++) {
  try {
    await runMigrations(url);
    break;
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined || !TRANSIENT_CODES.has(code) || attempt === ATTEMPTS) {
      throw error;
    }
    console.log(`База пока недоступна (${code}), попытка ${attempt} из ${ATTEMPTS}`);
    await sleep(DELAY_MS);
  }
}
console.log('Миграции применены');
