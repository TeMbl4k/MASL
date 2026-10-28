import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, type DbHandle } from './client.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import {
  broadcasts,
  broadcastUnsubscribes,
  linkTags,
  notifications,
  userAchievements,
  users,
} from './schema.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

const adminUrl = process.env.TEST_DATABASE_URL;

async function violatedConstraint(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    return (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
  }
  throw new Error('Expected the query to violate a constraint');
}

describe.skipIf(!adminUrl)('stage 7 tables (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let userId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    const [user] = await handle.db
      .insert(users)
      .values({ telegramId: 610_000_001, firstName: 'Анна', telegramAuthDate: new Date() })
      .returning({ id: users.id, newsEnabled: users.newsEnabled });
    userId = user!.id;
    expect(user!.newsEnabled).toBe(true);
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  it('keeps one row per user and achievement', async () => {
    const row = { userId, achievement: 'first_meetup' as const, earnedAt: new Date() };
    await handle.db.insert(userAchievements).values(row);
    expect(await violatedConstraint(handle.db.insert(userAchievements).values(row))).toBe(
      'user_achievements_user_id_achievement_pk',
    );
  });

  it('lets only private messages about the recipient go without a subject', async () => {
    const now = new Date();
    await expect(
      handle.db.insert(notifications).values({ userId, kind: 'user_achievements', sendAfter: now }),
    ).resolves.toBeDefined();
    await expect(
      handle.db.insert(notifications).values({ userId, kind: 'user_qr_print', sendAfter: now }),
    ).resolves.toBeDefined();
    expect(
      await violatedConstraint(
        handle.db.insert(notifications).values({ userId, kind: 'user_broadcast', sendAfter: now }),
      ),
    ).toBe('notifications_subject_chk');
    expect(
      await violatedConstraint(
        handle.db
          .insert(notifications)
          .values({ chatId: -100_200_300, kind: 'user_achievements', sendAfter: now }),
      ),
    ).toBe('notifications_subject_chk');
  });

  it('takes a tag or a broadcast as the subject', async () => {
    const now = new Date();
    const [tag] = await handle.db
      .insert(linkTags)
      .values({ slug: 'flyers', title: 'Листовки', createdAt: now })
      .returning({ id: linkTags.id });
    const [broadcast] = await handle.db
      .insert(broadcasts)
      .values({ authorId: userId, text: 'Неделя встреч MASL', interests: ['sport'], createdAt: now })
      .returning({ id: broadcasts.id, interests: broadcasts.interests });
    expect(broadcast!.interests).toEqual(['sport']);
    await handle.db.insert(notifications).values([
      { userId, tagId: tag!.id, kind: 'admin_tag_qr_print', sendAfter: now },
      { userId, broadcastId: broadcast!.id, kind: 'user_broadcast', sendAfter: now },
    ]);
    const unsubscribe = { broadcastId: broadcast!.id, userId, createdAt: now };
    await handle.db.insert(broadcastUnsubscribes).values(unsubscribe);
    expect(await violatedConstraint(handle.db.insert(broadcastUnsubscribes).values(unsubscribe))).toBe(
      'broadcast_unsubscribes_broadcast_id_user_id_pk',
    );
  });
});

describe.skipIf(!adminUrl)('migration 0008 backfill (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let folder: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!, { migrate: false });
    // The migrations up to 0007, as a database deployed with stage 6 has them.
    folder = mkdtempSync(join(tmpdir(), 'masl-migrations-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0008');
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await testDb?.drop();
  });

  it('turns «Новости MASL» on for existing users', async () => {
    const before = createDb(testDb.url, { max: 1 });
    try {
      await migrate(before.db, { migrationsFolder: folder });
      await before.db.execute(sql`
        insert into users (telegram_id, first_name, telegram_auth_date) values (610000100, 'Старый', now())`);
    } finally {
      await before.close();
    }
    await runMigrations(testDb.url);
    const after = createDb(testDb.url, { max: 1 });
    try {
      const rows = await after.db.select({ news: users.newsEnabled }).from(users);
      expect(rows).toEqual([{ news: true }]);
    } finally {
      await after.close();
    }
  });
});
