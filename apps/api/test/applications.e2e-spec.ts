import { and, eq } from 'drizzle-orm';
import { applicationEvents, lobbies, lobbyMembers, users } from '@masl/db';
import {
  APPLICATIONS_PENDING_MAX,
  APPLICATIONS_PER_DAY_MAX,
  KARMA,
  apiErrorDto,
  cancelApplicationResponse,
  creationContextDto,
  hostApplicationsResponse,
  karmaEventsResponse,
  lobbyDetailDto,
  myLobbiesResponse,
  type ApiErrorCode,
  type HostApplicationsResponse,
} from '@masl/shared';
import {
  CANARY_ADDRESS,
  addKarmaEvent,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  insertLobby,
  karmaEventsOf,
  setMembership,
  setUser,
  shiftCreatedAt,
  shiftLobby,
  type InjectResponse,
  type TestApp,
} from './helpers.js';

describe.skipIf(!adminUrl)('lobby applications e2e (requires TEST_DATABASE_URL)', () => {
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

  const apply = (token: string, id: string, payload: object = {}) =>
    t.app.inject({
      method: 'POST',
      url: `/api/lobbies/${id}/applications`,
      headers: authHeader(token),
      payload,
    });
  const cancelOwn = (token: string, id: string) =>
    t.app.inject({
      method: 'DELETE',
      url: `/api/lobbies/${id}/applications/me`,
      headers: authHeader(token),
      payload: {},
    });
  const list = (token: string, id: string) =>
    t.app.inject({ method: 'GET', url: `/api/lobbies/${id}/applications`, headers: authHeader(token) });
  const decide = (token: string, id: string, applicationId: string, decision: 'approve' | 'reject') =>
    t.app.inject({
      method: 'POST',
      url: `/api/lobbies/${id}/applications/${applicationId}/${decision}`,
      headers: authHeader(token),
      // The Mini App sends an empty JSON object, as with every mutation without data.
      payload: {},
    });
  const detail = (token: string, id: string) =>
    t.app.inject({ method: 'GET', url: `/api/lobbies/${id}`, headers: authHeader(token) });

  /** Asserts an apiError body with this code, and that it carries no exact place. */
  function expectError(response: InjectResponse, status: number, code: ApiErrorCode) {
    expect(response.statusCode, response.body).toBe(status);
    const body = apiErrorDto.parse(response.json());
    expect(body.code).toBe(code);
    assertNoExactPlace(body, code);
    return body;
  }

  const listBody = async (token: string, id: string): Promise<HostApplicationsResponse> => {
    const response = await list(token, id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    return hostApplicationsResponse.parse(response.json());
  };

  const membershipOf = async (lobbyId: string, userId: string) => {
    const [row] = await t.db
      .select()
      .from(lobbyMembers)
      .where(and(eq(lobbyMembers.lobbyId, lobbyId), eq(lobbyMembers.userId, userId)));
    return row ?? null;
  };
  const membersOf = (lobbyId: string) =>
    t.db.select().from(lobbyMembers).where(eq(lobbyMembers.lobbyId, lobbyId)).orderBy(lobbyMembers.id);
  const karmaOf = async (userId: string) =>
    (await t.db.select({ karma: users.karma }).from(users).where(eq(users.id, userId)))[0]!.karma;

  describe('POST /lobbies/:id/applications', () => {
    it('creates a pending application (201); a repeat is 200; the body is ignored', async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const other = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });

      const first = await apply(applicant.token, lobby.id, {
        userId: other.user.id,
        status: 'approved',
        karma: 100,
      });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.headers['cache-control']).toBe('private, no-store');
      const body = lobbyDetailDto.parse(first.json());
      expect(body).toMatchObject({
        access: 'public',
        viewer: { isHost: false, membershipStatus: 'pending', applyBlock: null },
        approvedCount: 0,
        members: null,
      });
      assertNoExactPlace(body, 'apply response');

      const repeat = await apply(applicant.token, lobby.id);
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toMatchObject({ viewer: { membershipStatus: 'pending' } });

      const rows = await membersOf(lobby.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: applicant.user.id, status: 'pending', decidedAt: null });
      expect(await membershipOf(lobby.id, other.user.id)).toBeNull();
      expect(await karmaOf(applicant.user.id)).toBe(KARMA.START);
    });

    it('an approved member applying again gets 200 with the member detail', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      const response = await apply(member.token, lobby.id);
      expect(response.statusCode).toBe(200);
      expect(lobbyDetailDto.parse(response.json())).toMatchObject({
        access: 'member',
        exactPlace: { address: CANARY_ADDRESS },
        viewer: { membershipStatus: 'approved' },
      });
    });

    it('409 own_lobby for the host; 404 for a missing lobby; 400 for a malformed id', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      expectError(await apply(host.token, lobby.id), 409, 'own_lobby');
      expectError(await apply(host.token, crypto.randomUUID()), 404, 'lobby_not_found');
      expect((await apply(host.token, 'not-a-uuid')).statusCode).toBe(400);
      expect(await membersOf(lobby.id)).toHaveLength(0);
    });

    it('T-KARMA-1: the karma threshold is inclusive', async () => {
      const host = await t.loginOnboarded();
      const low = await t.loginOnboarded();
      const exact = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, minKarma: 50 });
      await addKarmaEvent(t.db, low.user.id, 'manual', { delta: -1 });

      const refused = expectError(await apply(low.token, lobby.id), 403, 'karma_too_low');
      expect(refused.message).toBe('Нужна карма от 50. У вас 49');
      expect(await membershipOf(lobby.id, low.user.id)).toBeNull();
      expect((await apply(exact.token, lobby.id)).statusCode).toBe(201);
    });

    it('409 after the start, on a cancelled lobby and on a full one', async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const member = await t.loginOnboarded();

      const started = await insertLobby(t.db, { hostId: host.user.id });
      await shiftLobby(t.db, started.id, { startsInMin: -10 });
      expect(expectError(await apply(applicant.token, started.id), 409, 'lobby_closed').message).toBe(
        'Набор на встречу закрыт',
      );
      await shiftLobby(t.db, started.id, { startsInMin: -300 });
      expectError(await apply(applicant.token, started.id), 409, 'lobby_closed');

      const cancelled = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
      expectError(await apply(applicant.token, cancelled.id), 409, 'lobby_cancelled');

      const full = await insertLobby(t.db, { hostId: host.user.id, slots: 1 });
      await setMembership(t.db, full.id, member.user.id, 'approved');
      expectError(await apply(applicant.token, full.id), 409, 'lobby_full');

      for (const id of [started.id, cancelled.id, full.id]) {
        expect(await membershipOf(id, applicant.user.id)).toBeNull();
      }
    });

    it('re-apply after withdrawing (Q6): yes; after leaving an approved place or a rejection: no', async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });

      expect((await apply(applicant.token, lobby.id)).statusCode).toBe(201);
      expect((await cancelOwn(applicant.token, lobby.id)).statusCode).toBe(200);
      const again = await apply(applicant.token, lobby.id);
      expect(again.statusCode).toBe(201);
      expect(again.json()).toMatchObject({ viewer: { membershipStatus: 'pending' } });
      const row = await membershipOf(lobby.id, applicant.user.id);
      expect(row).toMatchObject({ status: 'pending', decidedAt: null, cancelledAt: null });
      expect(await membersOf(lobby.id)).toHaveLength(1);

      // Approved, then left: no way back (stops address harvesting).
      expect((await decide(host.token, lobby.id, row!.id, 'approve')).statusCode).toBe(200);
      expect((await cancelOwn(applicant.token, lobby.id)).statusCode).toBe(200);
      const left = expectError(await apply(applicant.token, lobby.id), 409, 'application_left');
      expect(left.message).toBe('Вы отменили участие — подать заявку снова нельзя');

      const rejectedLobby = await insertLobby(t.db, { hostId: host.user.id });
      await apply(applicant.token, rejectedLobby.id);
      const application = await membershipOf(rejectedLobby.id, applicant.user.id);
      expect((await decide(host.token, rejectedLobby.id, application!.id, 'reject')).statusCode).toBe(200);
      expectError(await apply(applicant.token, rejectedLobby.id), 409, 'application_rejected');
      expect(await membershipOf(rejectedLobby.id, applicant.user.id)).toMatchObject({ status: 'rejected' });
    });

    it(`429 for the ${APPLICATIONS_PENDING_MAX + 1}th pending application; started lobbies don't count`, async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      for (let i = 0; i < APPLICATIONS_PENDING_MAX; i++) {
        const lobby = await insertLobby(t.db, { hostId: host.user.id });
        await setMembership(t.db, lobby.id, applicant.user.id, 'pending');
      }
      const next = await insertLobby(t.db, { hostId: host.user.id });
      const refused = expectError(await apply(applicant.token, next.id), 429, 'pending_limit');
      expect(refused.message).toBe(
        `У вас уже ${APPLICATIONS_PENDING_MAX} заявок на рассмотрении. Дождитесь ответов или отмените лишние`,
      );
      expect(await membershipOf(next.id, applicant.user.id)).toBeNull();

      // A pending application on a lobby that has started no longer counts.
      const [oldest] = await t.db
        .select({ lobbyId: lobbyMembers.lobbyId })
        .from(lobbyMembers)
        .where(eq(lobbyMembers.userId, applicant.user.id))
        .limit(1);
      await shiftLobby(t.db, oldest!.lobbyId, { startsInMin: -5 });
      expect((await apply(applicant.token, next.id)).statusCode).toBe(201);
    });

    it(`429 for the ${APPLICATIONS_PER_DAY_MAX + 1}st application in 24 h`, async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      for (let i = 0; i < APPLICATIONS_PER_DAY_MAX; i++) {
        const lobby = await insertLobby(t.db, { hostId: host.user.id });
        await setMembership(t.db, lobby.id, applicant.user.id, 'rejected');
        await t.db.insert(applicationEvents).values({ userId: applicant.user.id, lobbyId: lobby.id });
      }
      const next = await insertLobby(t.db, { hostId: host.user.id });
      expectError(await apply(applicant.token, next.id), 429, 'applications_daily_limit');

      // The window is rolling: once the applications are older than 24 h, the cap lifts.
      await shiftCreatedAt(t.db, 'application_events', applicant.user.id, -25);
      expect((await apply(applicant.token, next.id)).statusCode).toBe(201);
    });

    it(`withdrawing and re-applying counts every apply towards the ${APPLICATIONS_PER_DAY_MAX} a day`, async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      for (let i = 0; i < APPLICATIONS_PER_DAY_MAX; i++) {
        // Only the daily cap is under test, not the per-minute limits.
        t.resetRateLimits();
        expect((await apply(applicant.token, lobby.id)).statusCode, `apply ${i + 1}`).toBe(201);
        expect((await cancelOwn(applicant.token, lobby.id)).statusCode, `cancel ${i + 1}`).toBe(200);
      }
      t.resetRateLimits();
      expectError(await apply(applicant.token, lobby.id), 429, 'applications_daily_limit');
      const other = await insertLobby(t.db, { hostId: host.user.id });
      expectError(await apply(applicant.token, other.id), 429, 'applications_daily_limit');
    });

    it('T-ABUSE-7 (apply): 403 not_onboarded before anything else', async () => {
      const host = await t.loginOnboarded();
      const fresh = await t.login();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      expectError(await apply(fresh.token, lobby.id), 403, 'not_onboarded');
      expectError(await apply(fresh.token, crypto.randomUUID()), 403, 'not_onboarded');
      expect(await membersOf(lobby.id)).toHaveLength(0);
    });

    it('T-ABUSE-4 (apply): a shadow-banned host’s lobby is a 404 for outsiders, byte for byte', async () => {
      const host = await t.loginOnboarded();
      const outsider = await t.loginOnboarded();
      const pending = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, pending.user.id, 'pending');
      await setUser(t.db, host.user.id, { isShadowBanned: true });

      const hidden = await apply(outsider.token, lobby.id);
      const missing = await apply(outsider.token, crypto.randomUUID());
      expect(hidden.statusCode).toBe(404);
      expect(hidden.body).toBe(missing.body);
      expect(await membershipOf(lobby.id, outsider.user.id)).toBeNull();
      // An existing applicant still sees it, and the repeat stays idempotent.
      expect((await apply(pending.token, lobby.id)).statusCode).toBe(200);
    });
  });

  describe('DELETE /lobbies/:id/applications/me', () => {
    it('withdrawing a pending application keeps karma; a repeat is 200 with karmaDelta 0', async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 30 });
      await apply(applicant.token, lobby.id);

      const response = await cancelOwn(applicant.token, lobby.id);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const body = cancelApplicationResponse.parse(response.json());
      expect(body).toMatchObject({
        karmaDelta: 0,
        lobby: { access: 'public', viewer: { membershipStatus: 'cancelled', applyBlock: null } },
      });
      assertNoExactPlace(body, 'cancel pending');
      expect(await membershipOf(lobby.id, applicant.user.id)).toMatchObject({
        status: 'cancelled',
        decidedAt: null,
      });
      expect(await karmaOf(applicant.user.id)).toBe(KARMA.START);

      const repeat = await cancelOwn(applicant.token, lobby.id);
      expect(repeat.statusCode).toBe(200);
      expect(repeat.json()).toMatchObject({ karmaDelta: 0 });
    });

    it('leaving more than 2 h before the start costs nothing', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 121 });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');

      const body = cancelApplicationResponse.parse((await cancelOwn(member.token, lobby.id)).json());
      expect(body.karmaDelta).toBe(0);
      expect(body.lobby).toMatchObject({ access: 'public', approvedCount: 0, members: null });
      assertNoExactPlace(body, 'left early');
      expect(await karmaOf(member.user.id)).toBe(KARMA.START);
      expect(await karmaEventsOf(t.db, member.user.id)).toHaveLength(0);
      expect(await membershipOf(lobby.id, member.user.id)).toMatchObject({ status: 'cancelled' });
    });

    it('leaving less than 2 h before the start costs −15 exactly once', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      await shiftLobby(t.db, lobby.id, { startsInMin: 60 });

      const response = await cancelOwn(member.token, lobby.id);
      expect(response.statusCode, response.body).toBe(200);
      const body = cancelApplicationResponse.parse(response.json());
      expect(body.karmaDelta).toBe(KARMA.LATE_CANCEL);
      expect(body.lobby.access).toBe('public');
      assertNoExactPlace(body, 'late cancel');
      expect(await karmaOf(member.user.id)).toBe(KARMA.START + KARMA.LATE_CANCEL);
      const events = await karmaEventsOf(t.db, member.user.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ reason: 'late_cancel', delta: KARMA.LATE_CANCEL, lobbyId: lobby.id });

      // Repeat: idempotent, no second penalty.
      const repeat = cancelApplicationResponse.parse((await cancelOwn(member.token, lobby.id)).json());
      expect(repeat.karmaDelta).toBe(0);
      expect(await karmaOf(member.user.id)).toBe(35);
      expect(await karmaEventsOf(t.db, member.user.id)).toHaveLength(1);
      // The profile shows the new karma and the history row.
      const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: authHeader(member.token) });
      expect(me.json()).toMatchObject({ karma: 35 });
      const history = await t.app.inject({
        method: 'GET',
        url: '/api/me/karma-events',
        headers: authHeader(member.token),
      });
      expect(karmaEventsResponse.parse(history.json()).items).toEqual([
        expect.objectContaining({
          reason: 'late_cancel',
          delta: -15,
          lobby: { id: lobby.id, title: expect.any(String) },
        }),
      ]);
    });

    it('a late withdrawal of a pending application costs nothing', async () => {
      const host = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 30 });
      await setMembership(t.db, lobby.id, applicant.user.id, 'pending');
      expect((await cancelOwn(applicant.token, lobby.id)).json()).toMatchObject({ karmaDelta: 0 });
      expect(await karmaOf(applicant.user.id)).toBe(KARMA.START);
    });

    it('409 after the start or on a cancelled lobby; 404 without an own application', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const rejected = await t.loginOnboarded();
      const outsider = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      await setMembership(t.db, lobby.id, rejected.user.id, 'rejected');

      expectError(await cancelOwn(outsider.token, lobby.id), 404, 'application_not_found');
      expectError(await cancelOwn(rejected.token, lobby.id), 404, 'application_not_found');
      expectError(await cancelOwn(host.token, lobby.id), 404, 'application_not_found');
      expectError(await cancelOwn(member.token, crypto.randomUUID()), 404, 'lobby_not_found');

      await shiftLobby(t.db, lobby.id, { startsInMin: -1 });
      expectError(await cancelOwn(member.token, lobby.id), 409, 'lobby_started');
      await shiftLobby(t.db, lobby.id, { startsInMin: 60 });
      await t.db
        .update(lobbies)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'other' })
        .where(eq(lobbies.id, lobby.id));
      expectError(await cancelOwn(member.token, lobby.id), 409, 'lobby_cancelled');
      expect(await membershipOf(lobby.id, member.user.id)).toMatchObject({ status: 'approved' });
      expect(await karmaOf(member.user.id)).toBe(KARMA.START);
    });

    it('T-IDOR-3: DELETE …/me touches only the caller’s row', async () => {
      const host = await t.loginOnboarded();
      const a = await t.loginOnboarded();
      const b = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, a.user.id, 'approved');
      await setMembership(t.db, lobby.id, b.user.id, 'pending');
      const before = await membershipOf(lobby.id, b.user.id);

      expect((await cancelOwn(a.token, lobby.id)).statusCode).toBe(200);
      expect(await membershipOf(lobby.id, a.user.id)).toMatchObject({ status: 'cancelled' });
      expect(await membershipOf(lobby.id, b.user.id)).toEqual(before);
    });

    it('a member can leave a shadow-banned host’s lobby; afterwards it is hidden from them', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, member.user.id, 'approved');
      await setUser(t.db, host.user.id, { isShadowBanned: true });

      const response = await cancelOwn(member.token, lobby.id);
      expect(response.statusCode, response.body).toBe(200);
      const body = cancelApplicationResponse.parse(response.json());
      expect(body.lobby.access).toBe('public');
      assertNoExactPlace(body, 'left a banned host’s lobby');
      expect((await detail(member.token, lobby.id)).statusCode).toBe(404);
    });
  });

  describe('GET /lobbies/:id/applications', () => {
    it('the host sees pending, approved and rejected with name, photo, karma and the newbie flag', async () => {
      const host = await t.loginOnboarded(undefined, 'Анна');
      const first = await t.loginOnboarded(undefined, 'Борис');
      const veteran = await t.loginOnboarded(undefined, 'Вера');
      const approved = await t.loginOnboarded(undefined, 'Глеб');
      const rejected = await t.loginOnboarded(undefined, 'Дина');
      const withdrawn = await t.loginOnboarded(undefined, 'Егор');
      const lobby = await insertLobby(t.db, { hostId: host.user.id, minKarma: 55 });
      await addKarmaEvent(t.db, veteran.user.id, 'attended');
      const base = Date.now() - 60_000;
      await setMembership(t.db, lobby.id, first.user.id, 'pending', { now: new Date(base) });
      await setMembership(t.db, lobby.id, veteran.user.id, 'pending', { now: new Date(base + 1000) });
      await setMembership(t.db, lobby.id, approved.user.id, 'approved');
      await setMembership(t.db, lobby.id, rejected.user.id, 'rejected');
      await setMembership(t.db, lobby.id, withdrawn.user.id, 'cancelled');

      const body = await listBody(host.token, lobby.id);
      assertNoExactPlace(body, 'applications list');
      expect(body.lobby).toMatchObject({ id: lobby.id, pendingCount: 2, approvedCount: 1 });
      expect(body.pending.map((a) => a.user.firstName)).toEqual(['Борис', 'Вера']);
      expect(body.pending[0]).toEqual({
        applicationId: (await membershipOf(lobby.id, first.user.id))!.id,
        status: 'pending',
        appliedAt: new Date(base).toISOString(),
        decidedAt: null,
        user: { firstName: 'Борис', photoUrl: null, karma: 50, isNewbie: true },
        meetsMinKarma: false,
      });
      expect(body.pending[1]).toMatchObject({
        user: { firstName: 'Вера', karma: 60, isNewbie: false },
        meetsMinKarma: true,
      });
      expect(body.approved.map((a) => a.user.firstName)).toEqual(['Глеб']);
      expect(body.approved[0]!.decidedAt).not.toBeNull();
      expect(body.rejected.map((a) => a.user.firstName)).toEqual(['Дина']);
      // Q9: no age, gender, ids or usernames of the applicants.
      for (const a of [...body.pending, ...body.approved, ...body.rejected]) {
        expect(Object.keys(a.user).sort()).toEqual(['firstName', 'isNewbie', 'karma', 'photoUrl']);
      }
    });

    it('T-IDOR-1: everyone but the host gets 403 not_host; 404 for a missing lobby', async () => {
      const host = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      const roles = {
        outsider: await t.loginOnboarded(),
        pending: await t.loginOnboarded(),
        approved: await t.loginOnboarded(),
        rejected: await t.loginOnboarded(),
      };
      await setMembership(t.db, lobby.id, roles.pending.user.id, 'pending');
      await setMembership(t.db, lobby.id, roles.approved.user.id, 'approved');
      await setMembership(t.db, lobby.id, roles.rejected.user.id, 'rejected');
      for (const [role, who] of Object.entries(roles)) {
        const refused = expectError(await list(who.token, lobby.id), 403, 'not_host');
        expect(refused.message, role).toBe('Управлять встречей может только хост');
      }
      expectError(await list(host.token, crypto.randomUUID()), 404, 'lobby_not_found');
      expect((await list(host.token, 'x')).statusCode).toBe(400);
    });

    it('T-ABUSE-5: a shadow-banned applicant applies normally but is invisible to the host', async () => {
      const host = await t.loginOnboarded();
      const banned = await t.loginOnboarded();
      const honest = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setUser(t.db, banned.user.id, { isShadowBanned: true });

      const applied = await apply(banned.token, lobby.id);
      expect(applied.statusCode).toBe(201);
      expect(applied.json()).toMatchObject({ viewer: { membershipStatus: 'pending' } });
      await apply(honest.token, lobby.id);

      const body = await listBody(host.token, lobby.id);
      expect(body.pending).toHaveLength(1);
      expect(body.lobby.pendingCount).toBe(1);
      const hostDetail = await detail(host.token, lobby.id);
      expect(hostDetail.json()).toMatchObject({ pendingCount: 1 });

      const hiddenId = (await membershipOf(lobby.id, banned.user.id))!.id;
      expectError(await decide(host.token, lobby.id, hiddenId, 'approve'), 404, 'application_not_found');
      expectError(await decide(host.token, lobby.id, hiddenId, 'reject'), 404, 'application_not_found');
      // Q22: the application just stays pending.
      expect(await membershipOf(lobby.id, banned.user.id)).toMatchObject({ status: 'pending' });
    });

    it('T-ABUSE-5: a member banned after approval answers decisions like any approved member', async () => {
      const host = await t.loginOnboarded();
      const banned = await t.loginOnboarded();
      const honest = await t.loginOnboarded();
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await setMembership(t.db, lobby.id, banned.user.id, 'approved');
      await setMembership(t.db, lobby.id, honest.user.id, 'approved');
      await setUser(t.db, banned.user.id, { isShadowBanned: true });

      const body = await listBody(host.token, lobby.id);
      const bannedId = (await membershipOf(lobby.id, banned.user.id))!.id;
      const honestId = (await membershipOf(lobby.id, honest.user.id))!.id;
      expect(body.approved.map((x) => x.applicationId).sort()).toEqual([bannedId, honestId].sort());

      // The ban must not be inferable: both members give identical answers (Q10, §5.5).
      for (const id of [honestId, bannedId]) {
        expectError(await decide(host.token, lobby.id, id, 'reject'), 409, 'application_not_pending');
        expect((await decide(host.token, lobby.id, id, 'approve')).statusCode).toBe(200);
      }
      expect(await membershipOf(lobby.id, banned.user.id)).toMatchObject({ status: 'approved' });
    });
  });

  describe('approve and reject', () => {
    it('approve gives the applicant the exact place; reject refuses; repeats are 200', async () => {
      const host = await t.loginOnboarded();
      const a = await t.loginOnboarded(undefined, 'Анна');
      const b = await t.loginOnboarded(undefined, 'Борис');
      const lobby = await insertLobby(t.db, { hostId: host.user.id });
      await apply(a.token, lobby.id);
      await apply(b.token, lobby.id);
      const aId = (await membershipOf(lobby.id, a.user.id))!.id;
      const bId = (await membershipOf(lobby.id, b.user.id))!.id;

      const approved = await decide(host.token, lobby.id, aId, 'approve');
      expect(approved.statusCode, approved.body).toBe(200);
      expect(approved.headers['cache-control']).toBe('private, no-store');
      const afterApprove = hostApplicationsResponse.parse(approved.json());
      assertNoExactPlace(afterApprove, 'approve response');
      expect(afterApprove.approved.map((x) => x.applicationId)).toEqual([aId]);
      expect(afterApprove.pending.map((x) => x.applicationId)).toEqual([bId]);
      expect(afterApprove.lobby).toMatchObject({ approvedCount: 1, pendingCount: 1 });
      expect(lobbyDetailDto.parse((await detail(a.token, lobby.id)).json())).toMatchObject({
        access: 'member',
        exactPlace: { address: CANARY_ADDRESS },
        viewer: { membershipStatus: 'approved' },
      });

      const rejected = hostApplicationsResponse.parse(
        (await decide(host.token, lobby.id, bId, 'reject')).json(),
      );
      expect(rejected.rejected.map((x) => x.applicationId)).toEqual([bId]);
      expect(rejected.pending).toEqual([]);
      const bDetail = lobbyDetailDto.parse((await detail(b.token, lobby.id)).json());
      expect(bDetail).toMatchObject({
        access: 'public',
        viewer: { membershipStatus: 'rejected', applyBlock: 'rejected' },
      });
      assertNoExactPlace(bDetail, 'rejected applicant');

      // Idempotent repeats; switching a decision is refused.
      expect((await decide(host.token, lobby.id, aId, 'approve')).statusCode).toBe(200);
      expect((await decide(host.token, lobby.id, bId, 'reject')).statusCode).toBe(200);
      expectError(await decide(host.token, lobby.id, bId, 'approve'), 409, 'application_not_pending');
      // Q10: an approved member can't be removed.
      expectError(await decide(host.token, lobby.id, aId, 'reject'), 409, 'application_not_pending');
      expect(await membershipOf(lobby.id, a.user.id)).toMatchObject({ status: 'approved' });

      // A withdrawn application can't be decided either.
      const c = await t.loginOnboarded();
      await apply(c.token, lobby.id);
      await cancelOwn(c.token, lobby.id);
      const cId = (await membershipOf(lobby.id, c.user.id))!.id;
      expectError(await decide(host.token, lobby.id, cId, 'approve'), 409, 'application_not_pending');
    });

    it('409 when full, after the start, on a cancelled lobby, or when the applicant’s karma fell (Q7)', async () => {
      const host = await t.loginOnboarded();
      const member = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const full = await insertLobby(t.db, { hostId: host.user.id, slots: 1 });
      await setMembership(t.db, full.id, member.user.id, 'approved');
      const fullApp = await setMembership(t.db, full.id, applicant.user.id, 'pending');
      const refused = expectError(
        await decide(host.token, full.id, fullApp.id, 'approve'),
        409,
        'lobby_full',
      );
      expect(refused.message).toBe('Все места заняты');
      // Rejecting still works on a full lobby.
      expect((await decide(host.token, full.id, fullApp.id, 'reject')).statusCode).toBe(200);

      const started = await insertLobby(t.db, { hostId: host.user.id });
      const startedApp = await setMembership(t.db, started.id, applicant.user.id, 'pending');
      await shiftLobby(t.db, started.id, { startsInMin: -1 });
      expectError(await decide(host.token, started.id, startedApp.id, 'approve'), 409, 'lobby_closed');
      expectError(await decide(host.token, started.id, startedApp.id, 'reject'), 409, 'lobby_closed');

      const cancelled = await insertLobby(t.db, { hostId: host.user.id });
      const cancelledApp = await setMembership(t.db, cancelled.id, applicant.user.id, 'pending');
      await t.db
        .update(lobbies)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: 'other' })
        .where(eq(lobbies.id, cancelled.id));
      expectError(await decide(host.token, cancelled.id, cancelledApp.id, 'approve'), 409, 'lobby_cancelled');

      const strict = await insertLobby(t.db, { hostId: host.user.id, minKarma: 50 });
      const strictApp = await setMembership(t.db, strict.id, applicant.user.id, 'pending');
      await addKarmaEvent(t.db, applicant.user.id, 'manual', { delta: -1 });
      const low = expectError(
        await decide(host.token, strict.id, strictApp.id, 'approve'),
        409,
        'applicant_karma_too_low',
      );
      expect(low.message).toBe('Карма участника ниже порога встречи');

      for (const [lobbyId, status] of [
        [started.id, 'pending'],
        [cancelled.id, 'pending'],
        [strict.id, 'pending'],
      ] as const) {
        expect(await membershipOf(lobbyId, applicant.user.id)).toMatchObject({ status });
      }
    });

    it('T-IDOR-2: a host can’t decide on another host’s applications', async () => {
      const hostA = await t.loginOnboarded();
      const hostB = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const lobbyA = await insertLobby(t.db, { hostId: hostA.user.id });
      const lobbyB = await insertLobby(t.db, { hostId: hostB.user.id });
      const appB = await setMembership(t.db, lobbyB.id, applicant.user.id, 'pending');
      const before = await membersOf(lobbyB.id);

      for (const decision of ['approve', 'reject'] as const) {
        expectError(await decide(hostA.token, lobbyA.id, appB.id, decision), 404, 'application_not_found');
        expectError(await decide(hostA.token, lobbyB.id, appB.id, decision), 403, 'not_host');
        expectError(await decide(applicant.token, lobbyB.id, appB.id, decision), 403, 'not_host');
        expectError(
          await decide(hostB.token, lobbyB.id, crypto.randomUUID(), decision),
          404,
          'application_not_found',
        );
      }
      expect((await decide(hostA.token, lobbyA.id, 'x', 'approve')).statusCode).toBe(400);
      expect(await membersOf(lobbyB.id)).toEqual(before);
      expect(await membersOf(lobbyA.id)).toEqual([]);
    });

    it('T-ABUSE-3 (rest): a creation-blocked user applies elsewhere and manages their lobby', async () => {
      const blocked = await t.loginOnboarded();
      const other = await t.loginOnboarded();
      const applicant = await t.loginOnboarded();
      const own = await insertLobby(t.db, { hostId: blocked.user.id });
      const elsewhere = await insertLobby(t.db, { hostId: other.user.id });
      await setUser(t.db, blocked.user.id, { lobbyCreationBlocked: true });

      expect((await apply(blocked.token, elsewhere.id)).statusCode).toBe(201);
      await apply(applicant.token, own.id);
      const appId = (await membershipOf(own.id, applicant.user.id))!.id;
      expect((await list(blocked.token, own.id)).statusCode).toBe(200);
      expect((await decide(blocked.token, own.id, appId, 'approve')).statusCode).toBe(200);
      expect((await cancelOwn(blocked.token, elsewhere.id)).statusCode).toBe(200);
    });
  });

  it('T-IDOR-4: «Мои», karma history and creation-context show only the caller’s data', async () => {
    const host = await t.loginOnboarded();
    const a = await t.loginOnboarded();
    const b = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id });
    await setMembership(t.db, lobby.id, a.user.id, 'approved');
    await shiftLobby(t.db, lobby.id, { startsInMin: 60 });
    expect((await cancelOwn(a.token, lobby.id)).json()).toMatchObject({ karmaDelta: KARMA.LATE_CANCEL });
    const pending = await insertLobby(t.db, { hostId: host.user.id });
    await apply(a.token, pending.id);

    const get = (token: string, url: string) =>
      t.app.inject({ method: 'GET', url, headers: authHeader(token) });
    const aMine = myLobbiesResponse.parse((await get(a.token, '/api/me/lobbies')).json());
    expect(aMine.joined.upcoming.map((l) => l.id)).toEqual([pending.id]);
    expect(aMine.joined.past.map((l) => l.id)).toEqual([lobby.id]);
    const bMine = myLobbiesResponse.parse((await get(b.token, '/api/me/lobbies')).json());
    expect(bMine).toEqual({
      hosting: { upcoming: [], past: [] },
      joined: { upcoming: [], past: [] },
      counts: { hosted: 0, joined: 0 },
    });
    expect(karmaEventsResponse.parse((await get(b.token, '/api/me/karma-events')).json()).items).toEqual([]);
    expect(karmaEventsResponse.parse((await get(a.token, '/api/me/karma-events')).json()).items).toHaveLength(
      1,
    );
    const bContext = creationContextDto.parse((await get(b.token, '/api/lobbies/creation-context')).json());
    expect(bContext).toMatchObject({ canCreate: true, createdInWindow: 0, upcomingCount: 0 });
    const hostContext = creationContextDto.parse(
      (await get(host.token, '/api/lobbies/creation-context')).json(),
    );
    expect(hostContext.upcomingCount).toBe(2);
  });

  it('401 without a token on every applications route', async () => {
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ['POST', `/api/lobbies/${id}/applications`],
      ['DELETE', `/api/lobbies/${id}/applications/me`],
      ['GET', `/api/lobbies/${id}/applications`],
      ['POST', `/api/lobbies/${id}/applications/${id}/approve`],
      ['POST', `/api/lobbies/${id}/applications/${id}/reject`],
    ] as const) {
      expect((await t.app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
