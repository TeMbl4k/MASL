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
import { lobbies, notifications, users, type NewLobby } from './schema.js';
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

function lobbyValues(hostId: string, startsInMs: number, overrides: Partial<NewLobby> = {}): NewLobby {
  const { station, line } = nearestStation(DINAMO);
  const startsAt = new Date(Date.now() + startsInMs);
  return {
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
    ...overrides,
  };
}

describe.skipIf(!adminUrl)('stage 3 tables (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let hostId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    const [host] = await handle.db
      .insert(users)
      .values({ telegramId: 300_000_001, firstName: 'Хост', telegramAuthDate: new Date() })
      .returning({ id: users.id });
    hostId = host!.id;
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  it('links a group to one lobby at a time and frees it once closed', async () => {
    const linked = { chatId: -100_123, chatLinkedAt: new Date() };
    expect(
      await violatedConstraint(
        handle.db.insert(lobbies).values(lobbyValues(hostId, HOUR_MS, { chatId: -1 })),
      ),
    ).toBe('lobbies_chat_consistency_chk');

    const [first] = await handle.db
      .insert(lobbies)
      .values(lobbyValues(hostId, HOUR_MS, linked))
      .returning({ id: lobbies.id });
    expect(
      await violatedConstraint(handle.db.insert(lobbies).values(lobbyValues(hostId, HOUR_MS, linked))),
    ).toBe('lobbies_active_chat_uq');

    await handle.db.update(lobbies).set({ chatClosedAt: new Date() }).where(eq(lobbies.id, first!.id));
    await expect(
      handle.db.insert(lobbies).values(lobbyValues(hostId, HOUR_MS, linked)),
    ).resolves.toBeDefined();
  });

  it('keeps one pending notification per dedupe key and exactly one target', async () => {
    const [lobby] = await handle.db
      .insert(lobbies)
      .values(lobbyValues(hostId, HOUR_MS))
      .returning({ id: lobbies.id });
    const row = { lobbyId: lobby!.id, kind: 'host_new_applications' as const, sendAfter: new Date() };

    expect(
      await violatedConstraint(
        handle.db.insert(notifications).values({ ...row, userId: hostId, chatId: -1 }),
      ),
    ).toBe('notifications_target_chk');
    expect(await violatedConstraint(handle.db.insert(notifications).values(row))).toBe(
      'notifications_target_chk',
    );

    const keyed = { ...row, userId: hostId, dedupeKey: `host_apps:${lobby!.id}` };
    const [pending] = await handle.db.insert(notifications).values(keyed).returning({ id: notifications.id });
    expect(await violatedConstraint(handle.db.insert(notifications).values(keyed))).toBe(
      'notifications_pending_dedupe_uq',
    );
    await handle.db
      .update(notifications)
      .set({ sentAt: new Date() })
      .where(eq(notifications.id, pending!.id));
    await expect(handle.db.insert(notifications).values(keyed)).resolves.toBeDefined();
  });
});

describe.skipIf(!adminUrl)('migration 0004 backfill (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let folder: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!, { migrate: false });
    // A copy of the migrations up to 0003, as a database deployed with stage 2 has them.
    folder = mkdtempSync(join(tmpdir(), 'masl-migrations-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0004');
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await testDb?.drop();
  });

  it('marks lobbies that ended or were cancelled before the bot as handled', async () => {
    const stage2 = createDb(testDb.url, { max: 1 });
    try {
      await migrate(stage2.db, { migrationsFolder: folder });
      const [host] = await stage2.db.execute<{ id: string }>(
        sql`insert into users (telegram_id, first_name, telegram_auth_date) values (300000002, 'Хост', now()) returning id`,
      );
      const insert = (startsInMs: number, status: string) =>
        stage2.db.execute<{ id: string }>(sql`
          insert into lobbies (host_id, category, title, starts_at, ends_at, location, address, place_hint,
            metro_station_id, public_location, slots, status, cancelled_at)
          values (${host!.id}, 'sport', 'Падел', now() + ${startsInMs} * interval '1 millisecond',
            now() + ${startsInMs + 2 * HOUR_MS} * interval '1 millisecond',
            ST_GeogFromText('SRID=4326;POINT(37.5585 55.7894)'), 'адрес', 'м. Динамо', 'x',
            ST_GeogFromText('SRID=4326;POINT(37.5585 55.7894)'), 3, ${status}::lobby_status,
            case when ${status} = 'cancelled' then now() end)
          returning id`);
      const [ended] = await insert(-5 * HOUR_MS, 'finished');
      const [cancelled] = await insert(5 * HOUR_MS, 'cancelled');
      const [upcoming] = await insert(5 * HOUR_MS, 'open');
      await stage2.close();

      await runMigrations(testDb.url);
      const db = createDb(testDb.url, { max: 1 });
      try {
        const rows = await db.db
          .select({
            id: lobbies.id,
            quorum: lobbies.quorumCheckedAt,
            ended: lobbies.endedNotifiedAt,
            requested: lobbies.attendanceRequestedAt,
            closed: lobbies.attendanceClosedAt,
          })
          .from(lobbies);
        const byId = new Map(rows.map((row) => [row.id, row]));
        for (const id of [ended!.id, cancelled!.id]) {
          const row = byId.get(id)!;
          expect([row.quorum, row.ended, row.requested, row.closed].every((v) => v instanceof Date)).toBe(
            true,
          );
        }
        expect(byId.get(upcoming!.id)).toMatchObject({
          quorum: null,
          ended: null,
          requested: null,
          closed: null,
        });
      } finally {
        await db.close();
      }
    } finally {
      await stage2.close().catch(() => undefined);
    }
  });
});
