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
import { lobbies, moderationCases, notifications, reports, users } from './schema.js';
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

describe.skipIf(!adminUrl)('stage 4 tables (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let hostId: string;
  let reporterId: string;
  let lobbyId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    const inserted = await handle.db
      .insert(users)
      .values([
        { telegramId: 400_000_001, firstName: 'Хост', telegramAuthDate: new Date() },
        { telegramId: 400_000_002, firstName: 'Анна', telegramAuthDate: new Date() },
      ])
      .returning({ id: users.id });
    hostId = inserted[0]!.id;
    reporterId = inserted[1]!.id;
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

  it('keeps the creation block flag, its reason and its time together', async () => {
    expect(
      await violatedConstraint(
        handle.db.update(users).set({ lobbyCreationBlocked: true }).where(eq(users.id, hostId)),
      ),
    ).toBe('users_creation_block_chk');
    expect(
      await violatedConstraint(
        handle.db
          .update(users)
          .set({ lobbyCreationBlocked: true, creationBlockedReason: 'moderation' })
          .where(eq(users.id, hostId)),
      ),
    ).toBe('users_creation_block_chk');
    await handle.db
      .update(users)
      .set({ lobbyCreationBlocked: true, creationBlockedReason: 'moderation', creationBlockedAt: new Date() })
      .where(eq(users.id, hostId));
    await handle.db
      .update(users)
      .set({
        lobbyCreationBlocked: false,
        creationBlockedReason: null,
        creationBlockedAt: null,
        creationBlockedLobbyId: null,
      })
      .where(eq(users.id, hostId));
  });

  it('allows one open case per kind and subject, one open «Не состоялась» case per lobby', async () => {
    const open = { kind: 'reports' as const, subjectId: hostId, openedAt: new Date() };
    const [first] = await handle.db
      .insert(moderationCases)
      .values(open)
      .returning({ id: moderationCases.id });
    expect(await violatedConstraint(handle.db.insert(moderationCases).values(open))).toBe(
      'moderation_cases_open_subject_uq',
    );
    await handle.db
      .update(moderationCases)
      .set({ resolvedAt: new Date(), decision: 'reports_dismissed' })
      .where(eq(moderationCases.id, first!.id));
    await expect(handle.db.insert(moderationCases).values(open)).resolves.toBeDefined();

    const notHeld = { kind: 'not_held' as const, subjectId: hostId, lobbyId, openedAt: new Date() };
    await handle.db.insert(moderationCases).values(notHeld);
    expect(await violatedConstraint(handle.db.insert(moderationCases).values(notHeld))).toBe(
      'moderation_cases_open_lobby_uq',
    );
  });

  it('checks the decision against the kind and the appeal text against the kind', async () => {
    const [row] = await handle.db
      .insert(moderationCases)
      .values({
        kind: 'appeal',
        subjectId: reporterId,
        appealText: 'Клуб отменил бронь корта',
        openedAt: new Date(),
      })
      .returning({ id: moderationCases.id });
    expect(
      await violatedConstraint(
        handle.db
          .update(moderationCases)
          .set({ resolvedAt: new Date(), decision: 'host_flaked' })
          .where(eq(moderationCases.id, row!.id)),
      ),
    ).toBe('moderation_cases_decision_chk');
    expect(
      await violatedConstraint(
        handle.db
          .update(moderationCases)
          .set({ decision: 'appeal_approved' })
          .where(eq(moderationCases.id, row!.id)),
      ),
    ).toBe('moderation_cases_resolved_chk');
    expect(
      await violatedConstraint(
        handle.db
          .insert(moderationCases)
          .values({ kind: 'reports', subjectId: reporterId, appealText: 'текст', openedAt: new Date() }),
      ),
    ).toBe('moderation_cases_appeal_chk');
  });

  it('keeps one report per reporter and lobby', async () => {
    const [kase] = await handle.db
      .select({ id: moderationCases.id })
      .from(moderationCases)
      .where(sql`${moderationCases.kind} = 'reports' and ${moderationCases.resolvedAt} is null`);
    const report = {
      reporterId,
      lobbyId,
      subjectId: hostId,
      caseId: kase!.id,
      reason: 'scam' as const,
      createdAt: new Date(),
    };
    await handle.db.insert(reports).values(report);
    expect(await violatedConstraint(handle.db.insert(reports).values({ ...report, reason: 'promo' }))).toBe(
      'reports_reporter_lobby_uq',
    );
  });

  it('needs a lobby or a case on every notification', async () => {
    const row = { userId: hostId, kind: 'moderator_new_case' as const, sendAfter: new Date() };
    expect(await violatedConstraint(handle.db.insert(notifications).values(row))).toBe(
      'notifications_subject_chk',
    );
    const [kase] = await handle.db.select({ id: moderationCases.id }).from(moderationCases).limit(1);
    await expect(handle.db.insert(notifications).values({ ...row, caseId: kase!.id })).resolves.toBeDefined();
  });
});

describe.skipIf(!adminUrl)('migration 0005 backfill (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let folder: string;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!, { migrate: false });
    // A copy of the migrations up to 0004, as a database deployed with stage 3 has them.
    folder = mkdtempSync(join(tmpdir(), 'masl-migrations-'));
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    const journalPath = join(folder, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < '0005');
    writeFileSync(journalPath, JSON.stringify(journal));
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await testDb?.drop();
  });

  it('marks stage 3 blocks as late cancels with the lobby and time of the latest penalty', async () => {
    const stage3 = createDb(testDb.url, { max: 1 });
    try {
      await migrate(stage3.db, { migrationsFolder: folder });
      const user = (telegramId: number, blocked: boolean) =>
        stage3.db.execute<{ id: string }>(sql`
          insert into users (telegram_id, first_name, telegram_auth_date, lobby_creation_blocked)
          values (${telegramId}, 'Хост', now(), ${blocked}) returning id`);
      const [flaked] = await user(400_000_011, true);
      const [blockedByHand] = await user(400_000_012, true);
      const [free] = await user(400_000_013, false);
      const insertLobby = () =>
        stage3.db.execute<{ id: string }>(sql`
          insert into lobbies (host_id, category, title, starts_at, ends_at, location, address, place_hint,
            metro_station_id, public_location, slots, status, cancelled_at)
          values (${flaked!.id}, 'sport', 'Падел', now(), now() + interval '2 hours',
            ST_GeogFromText('SRID=4326;POINT(37.5585 55.7894)'), 'адрес', 'м. Динамо', 'x',
            ST_GeogFromText('SRID=4326;POINT(37.5585 55.7894)'), 3, 'cancelled', now())
          returning id`);
      const [older] = await insertLobby();
      const [latest] = await insertLobby();
      for (const [lobby, hoursAgo] of [
        [older!.id, 48],
        [latest!.id, 5],
      ] as const) {
        await stage3.db.execute(sql`
          insert into karma_events (user_id, lobby_id, reason, delta, created_at)
          values (${flaked!.id}, ${lobby}, 'host_late_cancel', -30, now() - ${hoursAgo} * interval '1 hour')`);
      }
      await stage3.close();

      await runMigrations(testDb.url);
      const db = createDb(testDb.url, { max: 1 });
      try {
        const rows = await db.db
          .select({
            id: users.id,
            reason: users.creationBlockedReason,
            at: users.creationBlockedAt,
            lobbyId: users.creationBlockedLobbyId,
            moderator: users.isModerator,
          })
          .from(users);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const flakedRow = byId.get(flaked!.id)!;
        expect(flakedRow).toMatchObject({ reason: 'late_cancel', lobbyId: latest!.id, moderator: false });
        expect(Math.abs(flakedRow.at!.getTime() - (Date.now() - 5 * HOUR_MS))).toBeLessThan(60_000);
        expect(byId.get(blockedByHand!.id)).toMatchObject({ reason: 'late_cancel', lobbyId: null });
        expect(byId.get(blockedByHand!.id)!.at).toBeInstanceOf(Date);
        expect(byId.get(free!.id)).toMatchObject({ reason: null, at: null, lobbyId: null });
      } finally {
        await db.close();
      }
    } finally {
      await stage3.close().catch(() => undefined);
    }
  });
});
