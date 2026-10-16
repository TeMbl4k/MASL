import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)('миграции (нужен TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!, { migrate: false });
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it('несколько экземпляров, запущенных одновременно, применяют миграции по очереди', async () => {
    await Promise.all([runMigrations(testDb.url), runMigrations(testDb.url), runMigrations(testDb.url)]);

    const client = postgres(testDb.url, { max: 1 });
    try {
      const applied = await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
      const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
      expect(applied[0]!.count).toBe(journal.entries.length);
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});
