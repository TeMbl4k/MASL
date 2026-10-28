import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { nearestStation, placeHint } from '@masl/shared/metro';
import { createDb, type DbHandle } from './client.js';
import type { GeoPoint } from './geo.js';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.js';
import {
  linkTags,
  lobbies,
  lobbyInvites,
  notifications,
  supportRequests,
  userArrivals,
  users,
} from './schema.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

const adminUrl = process.env.TEST_DATABASE_URL;
const HOUR_MS = 3_600_000;
const DINAMO: GeoPoint = { lng: 37.5585, lat: 55.7894 };

async function violatedConstraint(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    return (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
  }
  throw new Error('Expected the query to violate a constraint');
}

describe.skipIf(!adminUrl)('stage 6 tables (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let hostId: string;
  let guestId: string;
  let lobbyId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    const inserted = await handle.db
      .insert(users)
      .values([
        { telegramId: 600_000_001, firstName: 'Хост', telegramAuthDate: new Date() },
        { telegramId: 600_000_002, firstName: 'Анна', telegramAuthDate: new Date() },
      ])
      .returning({ id: users.id });
    hostId = inserted[0]!.id;
    guestId = inserted[1]!.id;
    const { station, line } = nearestStation(DINAMO);
    const startsAt = new Date(Date.now() + HOUR_MS);
    const [lobby] = await handle.db
      .insert(lobbies)
      .values({
        hostId,
        category: 'sport',
        title: 'Падел',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * HOUR_MS),
        location: DINAMO,
        address: 'Ленинградский проспект, 36',
        placeHint: placeHint(station, line),
        metroStationId: station.id,
        publicLocation: { lng: station.lng, lat: station.lat },
        slots: 3,
      })
      .returning({ id: lobbies.id });
    lobbyId = lobby!.id;
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  it('gives every user a distinct 12-character hex public code', async () => {
    const rows = await handle.db.select({ code: users.publicCode }).from(users);
    expect(rows.every((r) => /^[0-9a-f]{12}$/.test(r.code))).toBe(true);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
    expect(
      await violatedConstraint(
        handle.db.update(users).set({ publicCode: rows[0]!.code }).where(eq(users.id, guestId)),
      ),
    ).toBe('users_public_code_uq');
  });

  it('keeps one invite per lobby and invitee, never to oneself, answered with a time', async () => {
    const invite = { lobbyId, inviterId: hostId, inviteeId: guestId, byHost: true, createdAt: new Date() };
    await handle.db.insert(lobbyInvites).values(invite);
    expect(await violatedConstraint(handle.db.insert(lobbyInvites).values(invite))).toBe(
      'lobby_invites_lobby_invitee_uq',
    );
    expect(
      await violatedConstraint(handle.db.insert(lobbyInvites).values({ ...invite, inviteeId: hostId })),
    ).toBe('lobby_invites_self_chk');
    expect(
      await violatedConstraint(
        handle.db.update(lobbyInvites).set({ status: 'accepted' }).where(eq(lobbyInvites.lobbyId, lobbyId)),
      ),
    ).toBe('lobby_invites_answered_chk');
  });

  it('closes a request whenever it carries a reply', async () => {
    const request = {
      authorId: guestId,
      category: 'bug' as const,
      text: 'Не открывается карта',
      createdAt: new Date(),
    };
    expect(
      await violatedConstraint(
        handle.db.insert(supportRequests).values({ ...request, reply: 'Спасибо', repliedAt: new Date() }),
      ),
    ).toBe('support_requests_closed_chk');
    expect(
      await violatedConstraint(
        handle.db.insert(supportRequests).values({ ...request, reply: 'Спасибо', closedAt: new Date() }),
      ),
    ).toBe('support_requests_reply_chk');
  });

  it('takes a request as the subject of a notification', async () => {
    const [request] = await handle.db
      .insert(supportRequests)
      .values({
        authorId: guestId,
        category: 'idea',
        text: 'Тёмная тема и так хороша',
        createdAt: new Date(),
      })
      .returning({ id: supportRequests.id });
    const row = { userId: hostId, kind: 'admin_new_support' as const, sendAfter: new Date() };
    expect(await violatedConstraint(handle.db.insert(notifications).values(row))).toBe(
      'notifications_subject_chk',
    );
    await expect(
      handle.db.insert(notifications).values({ ...row, supportId: request!.id }),
    ).resolves.toBeDefined();
  });

  it('records one source per user: a referrer or a tag, not both', async () => {
    const [tag] = await handle.db
      .insert(linkTags)
      .values({ slug: 'channel', title: 'Канал', createdAt: new Date() })
      .returning({ id: linkTags.id });
    expect(
      await violatedConstraint(
        handle.db
          .insert(userArrivals)
          .values({ userId: guestId, referrerId: hostId, tagId: tag!.id, createdAt: new Date() }),
      ),
    ).toBe('user_arrivals_one_source_chk');
    await handle.db.insert(userArrivals).values({ userId: guestId, tagId: tag!.id, createdAt: new Date() });
    expect(
      await violatedConstraint(
        handle.db.insert(userArrivals).values({ userId: guestId, referrerId: hostId, createdAt: new Date() }),
      ),
    ).toBe('user_arrivals_pkey');
    expect(
      await violatedConstraint(
        handle.db.insert(linkTags).values({ slug: 'channel', title: 'x', createdAt: new Date() }),
      ),
    ).toBe('link_tags_slug_uq');
  });
});

describe.skipIf(!adminUrl)('migration 0007 backfill (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let folder: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!, { migrate: false });
    // The migrations up to 0006, as a database deployed with the user agreement has them.
    folder = mkdtempSync(join(tmpdir(), 'masl-migrations-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0007');
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await testDb?.drop();
  });

  it('gives existing users distinct codes, search and invites on', async () => {
    const before = createDb(testDb.url, { max: 1 });
    try {
      await migrate(before.db, { migrationsFolder: folder });
      for (let i = 0; i < 50; i++) {
        await before.db.execute(sql`
          insert into users (telegram_id, first_name, telegram_auth_date)
          values (${600_000_100 + i}, 'Старый', now())`);
      }
    } finally {
      await before.close();
    }
    await runMigrations(testDb.url);
    const after = createDb(testDb.url, { max: 1 });
    try {
      const rows = await after.db
        .select({ code: users.publicCode, hide: users.hideFromSearch, invites: users.invitesEnabled })
        .from(users);
      expect(rows).toHaveLength(50);
      expect(new Set(rows.map((r) => r.code)).size).toBe(50);
      expect(rows.every((r) => /^[0-9a-f]{12}$/.test(r.code) && !r.hide && r.invites)).toBe(true);
    } finally {
      await after.close();
    }
  });
});
