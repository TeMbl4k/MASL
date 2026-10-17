import { and, eq } from 'drizzle-orm';
import { lobbies, lobbyMembers } from '@masl/db';
import { APPLICATIONS_PENDING_MAX } from '@masl/shared';
import {
  adminUrl,
  authHeader,
  bootApp,
  insertLobby,
  setMembership,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

/**
 * Real concurrent transactions through the app (spec §8): every case fires its requests at
 * once with Promise.all, so they meet on the row locks in PostgreSQL.
 */
describe.skipIf(!adminUrl)('lobby races e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootApp();
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  const apply = (token: string, id: string) =>
    t.app.inject({
      method: 'POST',
      url: `/api/lobbies/${id}/applications`,
      headers: authHeader(token),
      payload: {},
    });
  const cancelOwn = (token: string, id: string) =>
    t.app.inject({ method: 'DELETE', url: `/api/lobbies/${id}/applications/me`, headers: authHeader(token) });
  const approve = (token: string, id: string, applicationId: string) =>
    t.app.inject({
      method: 'POST',
      url: `/api/lobbies/${id}/applications/${applicationId}/approve`,
      headers: authHeader(token),
    });
  const cancelLobby = (token: string, id: string) =>
    t.app.inject({
      method: 'POST',
      url: `/api/lobbies/${id}/cancel`,
      headers: authHeader(token),
      payload: { reason: 'plans_changed' },
    });

  /** No race may end in a server error or a deadlock (40P01 → 409 `retry`). */
  function expectNoServerErrors(responses: InjectResponse[]) {
    for (const r of responses) {
      expect(r.statusCode, r.body).toBeLessThan(500);
      if (r.statusCode >= 400) expect(r.json().code, r.body).not.toBe('retry');
    }
  }

  const codes = (responses: InjectResponse[]) => responses.map((r) => r.statusCode).sort();
  const membersOf = (lobbyId: string) =>
    t.db.select().from(lobbyMembers).where(eq(lobbyMembers.lobbyId, lobbyId));
  const membershipOf = async (lobbyId: string, userId: string) =>
    (
      await t.db
        .select()
        .from(lobbyMembers)
        .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.userId, userId)))
    )[0] ?? null;

  it('T-RACE-1: 5 parallel applies by one user make one application, all 2xx', async () => {
    const host = await t.loginOnboarded();
    const applicant = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id });

    const responses = await Promise.all(Array.from({ length: 5 }, () => apply(applicant.token, lobby.id)));
    expectNoServerErrors(responses);
    expect(codes(responses)).toEqual([200, 200, 200, 200, 201]);
    const rows = await membersOf(lobby.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: applicant.user.id, status: 'pending' });
  });

  it('T-RACE-2: 6 parallel approvals of 6 applicants for 2 places approve exactly 2', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const applicant = await t.loginOnboarded();
      ids.push((await setMembership(t.db, lobby.id, applicant.user.id, 'pending')).id);
    }

    const responses = await Promise.all(ids.map((id) => approve(host.token, lobby.id, id)));
    expectNoServerErrors(responses);
    expect(codes(responses)).toEqual([200, 200, 409, 409, 409, 409]);
    for (const r of responses.filter((x) => x.statusCode === 409)) {
      expect(r.json()).toMatchObject({ code: 'lobby_full' });
    }
    const rows = await membersOf(lobby.id);
    expect(rows.filter((r) => r.status === 'approved')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(4);
  });

  it('T-RACE-2: the last place under parallel approvals, repeated', async () => {
    const host = await t.loginOnboarded();
    for (let round = 0; round < 5; round++) {
      const lobby = await insertLobby(t.db, { hostId: host.user.id, slots: 1 });
      const a = await t.loginOnboarded();
      const b = await t.loginOnboarded();
      const ids = [
        (await setMembership(t.db, lobby.id, a.user.id, 'pending')).id,
        (await setMembership(t.db, lobby.id, b.user.id, 'pending')).id,
      ];
      const responses = await Promise.all(ids.map((id) => approve(host.token, lobby.id, id)));
      expectNoServerErrors(responses);
      expect(codes(responses)).toEqual([200, 409]);
      expect((await membersOf(lobby.id)).filter((r) => r.status === 'approved')).toHaveLength(1);
    }
  });

  it(`T-RACE-4: parallel applies to 12 lobbies leave at most ${APPLICATIONS_PENDING_MAX} pending`, async () => {
    const host = await t.loginOnboarded();
    const applicant = await t.loginOnboarded();
    const lobbyIds: string[] = [];
    for (let i = 0; i < 12; i++) lobbyIds.push((await insertLobby(t.db, { hostId: host.user.id })).id);

    const responses = await Promise.all(lobbyIds.map((id) => apply(applicant.token, id)));
    expectNoServerErrors(responses);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(APPLICATIONS_PENDING_MAX);
    const refused = responses.filter((r) => r.statusCode !== 201);
    expect(refused).toHaveLength(12 - APPLICATIONS_PENDING_MAX);
    for (const r of refused) expect(r.json()).toMatchObject({ code: 'pending_limit' });
    const pending = await t.db
      .select({ id: lobbyMembers.id })
      .from(lobbyMembers)
      .where(and(eq(lobbyMembers.userId, applicant.user.id), eq(lobbyMembers.status, 'pending')));
    expect(pending).toHaveLength(APPLICATIONS_PENDING_MAX);
  });

  it('T-RACE-5: approve racing the applicant’s cancel ends in a consistent state', async () => {
    const host = await t.loginOnboarded();
    for (let round = 0; round < 6; round++) {
      const applicant = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const { id } = await setMembership(t.db, lobby.id, applicant.user.id, 'pending');

      const [approved, cancelled] = await Promise.all([
        approve(host.token, lobby.id, id),
        cancelOwn(applicant.token, lobby.id),
      ]);
      expectNoServerErrors([approved, cancelled]);
      // The applicant's cancel always wins in the end; it either withdrew or left.
      expect(cancelled.statusCode).toBe(200);
      const row = await membershipOf(lobby.id, applicant.user.id);
      expect(row!.status).toBe('cancelled');
      if (approved.statusCode === 200) {
        // Approved first, then left: decided_at marks it as "left".
        expect(row!.decidedAt).not.toBeNull();
      } else {
        expect(approved.json()).toMatchObject({ code: 'application_not_pending' });
        expect(row!.decidedAt).toBeNull();
      }
      expect(cancelled.json().karmaDelta).toBe(0);
    }
  });

  it('T-RACE-6: apply or approve racing a host cancel: either it happened before, or it is refused', async () => {
    const host = await t.loginOnboarded();
    for (let round = 0; round < 6; round++) {
      const applicant = await t.loginOnboarded();
      const pending = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const { id } = await setMembership(t.db, lobby.id, pending.user.id, 'pending');

      const [applied, decided, cancelled] = await Promise.all([
        apply(applicant.token, lobby.id),
        approve(host.token, lobby.id, id),
        cancelLobby(host.token, lobby.id),
      ]);
      expectNoServerErrors([applied, decided, cancelled]);
      expect(cancelled.statusCode).toBe(200);
      const [row] = await t.db
        .select({ status: lobbies.status })
        .from(lobbies)
        .where(eq(lobbies.id, lobby.id));
      expect(row!.status).toBe('cancelled');

      // A write that won the lobby lock before the cancel stays; one that came after is refused.
      const applicantRow = await membershipOf(lobby.id, applicant.user.id);
      if (applied.statusCode === 201) {
        expect(applicantRow).toMatchObject({ status: 'pending' });
      } else {
        expect(applied.json()).toMatchObject({ code: 'lobby_cancelled' });
        expect(applicantRow).toBeNull();
      }
      const pendingRow = await membershipOf(lobby.id, pending.user.id);
      if (decided.statusCode === 200) {
        expect(pendingRow).toMatchObject({ status: 'approved' });
      } else {
        expect(decided.json()).toMatchObject({ code: 'lobby_cancelled' });
        expect(pendingRow).toMatchObject({ status: 'pending' });
      }
    }
  });
});
