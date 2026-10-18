import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { LOBBY_MIN_KARMA_MAX } from '@masl/shared';
import { nearestStation, placeHint } from '@masl/shared/metro';
import { createDb, type DbHandle } from './client.js';
import type { GeoPoint } from './geo.js';
import { MIGRATIONS_FOLDER } from './migrate.js';
import { lobbies, lobbyMembers, users, type NewLobby } from './schema.js';
import { createTestDatabase, type TestDatabase } from './testing.js';

const adminUrl = process.env.TEST_DATABASE_URL;

const DINAMO: GeoPoint = { lng: 37.5585, lat: 55.7894 };

/** Postgres constraint name of a failed insert/update (Drizzle keeps the driver error in `cause`). */
async function violatedConstraint(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name;
  }
  throw new Error('Expected the query to violate a constraint');
}

describe.skipIf(!adminUrl)('lobby constraints (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let handle: DbHandle;
  let hostId: string;
  let otherHostId: string;
  let memberId: string;
  let telegramId = 200_000_000;

  async function insertUser(firstName: string): Promise<string> {
    telegramId += 1;
    const [row] = await handle.db
      .insert(users)
      .values({ telegramId, firstName, telegramAuthDate: new Date() })
      .returning({ id: users.id });
    return row!.id;
  }

  function lobbyValues(overrides: Partial<NewLobby> = {}): NewLobby {
    const { station, line } = nearestStation(DINAMO);
    const startsAt = new Date(Date.now() + 3600_000);
    return {
      hostId,
      category: 'sport',
      title: 'Падел-теннис 2х2',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3600_000),
      location: DINAMO,
      address: 'Ленинградский проспект, 36',
      placeHint: placeHint(station, line),
      metroStationId: station.id,
      publicLocation: { lng: station.lng, lat: station.lat },
      slots: 3,
      ...overrides,
    };
  }

  async function insertLobby(overrides: Partial<NewLobby> = {}): Promise<string> {
    const [row] = await handle.db
      .insert(lobbies)
      .values(lobbyValues(overrides))
      .returning({ id: lobbies.id });
    return row!.id;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    handle = createDb(testDb.url, { max: 2 });
    hostId = await insertUser('Хост');
    otherHostId = await insertUser('Другой хост');
    memberId = await insertUser('Участник');
  });

  afterAll(async () => {
    await handle?.close();
    await testDb?.drop();
  });

  it('applies every migration, with public_location as geography', async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
    const [applied] = await handle.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(applied?.count).toBe(journal.entries.length);

    const [column] = await handle.db.execute<{ udt_name: string; is_nullable: string }>(
      sql`select udt_name, is_nullable from information_schema.columns
          where table_name = 'lobbies' and column_name = 'public_location'`,
    );
    expect(column).toEqual({ udt_name: 'geography', is_nullable: 'NO' });
  });

  it('defaults far_from_metro and client_request_id, and reads the public point back', async () => {
    const id = await insertLobby();
    const [row] = await handle.db.select().from(lobbies).where(eq(lobbies.id, id));
    const { station } = nearestStation(DINAMO);
    expect(row?.farFromMetro).toBe(false);
    expect(row?.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.metroStationId).toBe(station.id);
    expect(row?.publicLocation.lng).toBeCloseTo(station.lng, 6);
    expect(row?.publicLocation.lat).toBeCloseTo(station.lat, 6);
    expect(row?.cancelComment).toBeNull();
  });

  it('requires cancelled_at exactly when the lobby is cancelled', async () => {
    expect(
      await violatedConstraint(handle.db.insert(lobbies).values(lobbyValues({ status: 'cancelled' }))),
    ).toBe('lobbies_cancel_consistency_chk');
    expect(
      await violatedConstraint(
        handle.db.insert(lobbies).values(lobbyValues({ status: 'open', cancelledAt: new Date() })),
      ),
    ).toBe('lobbies_cancel_consistency_chk');

    const id = await insertLobby({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: 'plans_changed',
      cancelComment: 'Заболел',
    });
    const [row] = await handle.db.select().from(lobbies).where(eq(lobbies.id, id));
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelComment).toBe('Заболел');
  });

  it(`rejects min_karma above ${LOBBY_MIN_KARMA_MAX}`, async () => {
    expect(
      await violatedConstraint(
        handle.db.insert(lobbies).values(lobbyValues({ minKarma: LOBBY_MIN_KARMA_MAX + 1 })),
      ),
    ).toBe('lobbies_min_karma_max_chk');
    await expect(insertLobby({ minKarma: LOBBY_MIN_KARMA_MAX })).resolves.toBeTypeOf('string');
  });

  it('rejects a duplicate create request of the same host only', async () => {
    const clientRequestId = randomUUID();
    await insertLobby({ clientRequestId });
    expect(await violatedConstraint(handle.db.insert(lobbies).values(lobbyValues({ clientRequestId })))).toBe(
      'lobbies_host_request_uq',
    );
    await expect(insertLobby({ hostId: otherHostId, clientRequestId })).resolves.toBeTypeOf('string');
  });

  it('requires decided_at for decided memberships', async () => {
    const lobbyId = await insertLobby();
    for (const status of ['approved', 'rejected', 'attended', 'no_show'] as const) {
      expect(
        await violatedConstraint(
          handle.db.insert(lobbyMembers).values({ lobbyId, userId: memberId, status }),
        ),
      ).toBe('lobby_members_decided_chk');
    }

    await handle.db.insert(lobbyMembers).values({ lobbyId, userId: memberId, status: 'pending' });
    expect(
      await violatedConstraint(
        handle.db.update(lobbyMembers).set({ status: 'approved' }).where(eq(lobbyMembers.lobbyId, lobbyId)),
      ),
    ).toBe('lobby_members_decided_chk');
    await handle.db
      .update(lobbyMembers)
      .set({ status: 'approved', decidedAt: new Date() })
      .where(eq(lobbyMembers.lobbyId, lobbyId));
  });

  it('requires cancelled_at exactly when the membership is cancelled', async () => {
    const lobbyId = await insertLobby();
    expect(
      await violatedConstraint(
        handle.db.insert(lobbyMembers).values({ lobbyId, userId: memberId, status: 'cancelled' }),
      ),
    ).toBe('lobby_members_cancel_consistency_chk');
    expect(
      await violatedConstraint(
        handle.db
          .insert(lobbyMembers)
          .values({ lobbyId, userId: memberId, status: 'pending', cancelledAt: new Date() }),
      ),
    ).toBe('lobby_members_cancel_consistency_chk');

    // Cancelled pending (no decided_at) and left after approval (decided_at set) are both valid.
    await handle.db
      .insert(lobbyMembers)
      .values({ lobbyId, userId: memberId, status: 'cancelled', cancelledAt: new Date() });
    const otherLobbyId = await insertLobby();
    await handle.db.insert(lobbyMembers).values({
      lobbyId: otherLobbyId,
      userId: memberId,
      status: 'cancelled',
      decidedAt: new Date(),
      cancelledAt: new Date(),
    });
    const rows = await handle.db.select().from(lobbyMembers).where(eq(lobbyMembers.userId, memberId));
    expect(rows.filter((r) => r.status === 'cancelled')).toHaveLength(2);
  });
});
