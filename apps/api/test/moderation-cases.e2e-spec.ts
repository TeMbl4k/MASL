import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { lobbies, moderationActions, moderationCases, notifications, users } from '@masl/db';
import {
  KARMA,
  MODERATION_PAGE_SIZE,
  adminCaseDto,
  adminCasesResponse,
  lobbyDetailDto,
  meDto,
  type AuthResponse,
  type ModerationCaseKind,
} from '@masl/shared';
import { creationBlock } from '../src/users/creation-block.js';
import {
  addKarmaEvent,
  adminUrl,
  assertNoExactPlace,
  authHeader,
  bootApp,
  freshTelegramId,
  insertLobby,
  insertUser,
  karmaEventsOf,
  setMembership,
  setUser,
  type TestApp,
} from './helpers.js';

const HOUR_MS = 3_600_000;

describe.skipIf(!adminUrl)('moderation queue and case decisions e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  const adminTelegramId = freshTelegramId();

  beforeAll(async () => {
    t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: String(adminTelegramId) } });
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const post = (token: string, url: string, payload: object) =>
    t.app.inject({ method: 'POST', url, headers: authHeader(token), payload });
  const resolve = (token: string, caseId: string, payload: object) =>
    post(token, `/api/admin/cases/${caseId}/resolve`, payload);
  const moderator = async (): Promise<AuthResponse> => {
    const auth = await t.loginOnboarded();
    await setUser(t.db, auth.user.id, { isModerator: true });
    return auth;
  };
  /** An onboarded user whose account is two days old, so their reports count. */
  const reporter = async (): Promise<AuthResponse> => {
    const auth = await t.loginOnboarded();
    await t.db
      .update(users)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(users.id, auth.user.id));
    return auth;
  };
  const userRow = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0]!;
  const openCase = async (
    kind: ModerationCaseKind,
    subjectId: string,
    patch: Partial<typeof moderationCases.$inferInsert> = {},
  ) => {
    const [row] = await t.db
      .insert(moderationCases)
      .values({
        kind,
        subjectId,
        openedAt: new Date(),
        appealText: kind === 'appeal' ? 'Клуб отменил бронь корта за час до игры' : null,
        ...patch,
      })
      .returning({ id: moderationCases.id });
    return row!.id;
  };
  /** A host shadow-banned by three counted reports on one lobby; returns the case. */
  const reportedHost = async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, title: 'Бизнес-завтрак' });
    for (let i = 0; i < 3; i++) {
      const r = await reporter();
      expect((await post(r.token, `/api/lobbies/${lobby.id}/reports`, { reason: 'scam' })).statusCode).toBe(
        200,
      );
    }
    const [kase] = await t.db
      .select({ id: moderationCases.id })
      .from(moderationCases)
      .where(and(eq(moderationCases.subjectId, host.user.id), isNull(moderationCases.resolvedAt)));
    expect((await userRow(host.user.id)).isShadowBanned).toBe(true);
    return { host, lobby, caseId: kase!.id };
  };
  const logOf = (subjectId: string) =>
    t.db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.subjectId, subjectId))
      .orderBy(moderationActions.id);

  it('T-IDOR: users get 403 on every admin route; the role is read on every request', async () => {
    const user = await t.loginOnboarded();
    const kaseId = await openCase('reports', user.user.id);
    const lobby = await insertLobby(t.db, { hostId: user.user.id });
    const calls = [
      () => get(user.token, '/api/admin/cases'),
      () => get(user.token, `/api/admin/cases/${kaseId}`),
      () => resolve(user.token, kaseId, { decision: 'reports_dismissed' }),
      () => post(user.token, `/api/admin/lobbies/${lobby.id}/cancel`, {}),
    ];
    for (const call of calls) {
      const response = await call();
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        statusCode: 403,
        code: 'forbidden_moderation',
        message: 'Раздел только для модераторов',
      });
    }
    expect(meDto.parse((await get(user.token, '/api/me')).json())).toMatchObject({
      role: 'user',
      moderationQueue: null,
    });

    const mod = await moderator();
    expect((await get(mod.token, '/api/admin/cases')).statusCode).toBe(200);
    const me = meDto.parse((await get(mod.token, '/api/me')).json());
    expect(me.role).toBe('moderator');
    expect(me.moderationQueue).toBeGreaterThanOrEqual(1);
    // Revoked: the very next request is refused, with the same session token.
    await setUser(t.db, mod.user.id, { isModerator: false });
    expect((await get(mod.token, '/api/admin/cases')).statusCode).toBe(403);

    const admin = await t.loginOnboarded(adminTelegramId);
    expect((await get(admin.token, '/api/admin/cases')).statusCode).toBe(200);
    expect(meDto.parse((await get(admin.token, '/api/me')).json()).role).toBe('admin');
    await t.db.delete(moderationCases).where(eq(moderationCases.id, kaseId));
  });

  it('lists open cases shadow-banned first, then the oldest, page by page, with counts per kind', async () => {
    const mod = await moderator();
    const created: string[] = [];
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR_MS);
    const banned = await openCase('reports', (await insertUser(t.db)).id, {
      openedAt: at(1),
      shadowBannedAt: at(1),
    });
    created.push(banned);
    for (let i = 0; i < MODERATION_PAGE_SIZE; i++) {
      created.push(await openCase('appeal', (await insertUser(t.db)).id, { openedAt: at(100 - i) }));
    }
    const resolved = await openCase('reports', (await insertUser(t.db)).id, { openedAt: at(200) });
    await t.db
      .update(moderationCases)
      .set({ resolvedAt: new Date(), decision: 'reports_dismissed' })
      .where(eq(moderationCases.id, resolved));

    const first = adminCasesResponse.parse((await get(mod.token, '/api/admin/cases')).json());
    expect(first.items).toHaveLength(MODERATION_PAGE_SIZE);
    expect(first.counts).toEqual({
      all: created.length,
      reports: 1,
      not_held: 0,
      appeal: MODERATION_PAGE_SIZE,
    });
    expect(first.nextCursor).not.toBeNull();
    const second = adminCasesResponse.parse(
      (await get(mod.token, `/api/admin/cases?cursor=${first.nextCursor}`)).json(),
    );
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((c) => c.id)).toEqual(created);
    expect(first.items[0]).toMatchObject({ kind: 'reports', reports: { total: 0, counted: 0, reasons: [] } });
    expect(first.items[1]).toMatchObject({ kind: 'appeal', reports: null, notHeld: null });

    const reportsOnly = adminCasesResponse.parse(
      (await get(mod.token, '/api/admin/cases?kind=reports')).json(),
    );
    expect(reportsOnly.items.map((c) => c.id)).toEqual([banned]);
    expect((await get(mod.token, '/api/admin/cases?cursor=garbage')).json()).toMatchObject({
      code: 'invalid_cursor',
    });
    await t.db.delete(moderationCases).where(inArray(moderationCases.id, [...created, resolved]));
  });

  it('shows a reports case with the reporters, never the exact place; the subject may not decide it', async () => {
    const { host, lobby, caseId } = await reportedHost();
    const mod = await moderator();
    const response = await get(mod.token, `/api/admin/cases/${caseId}`);
    expect(response.statusCode).toBe(200);
    assertNoExactPlace(response.json(), 'admin case');
    const kase = adminCaseDto.parse(response.json());
    expect(kase).toMatchObject({
      kind: 'reports',
      status: 'open',
      subject: { id: host.user.id, isShadowBanned: true, role: 'user' },
      stats: { reportsReceived: 3 },
      lobby: { id: lobby.id, title: 'Бизнес-завтрак', status: 'open' },
      upcomingLobbies: 1,
      isSelf: false,
    });
    expect(kase.reports).toHaveLength(3);
    expect(kase.reports.every((r) => r.notCounted === null && r.lobby.id === lobby.id)).toBe(true);

    await setUser(t.db, host.user.id, { isModerator: true });
    expect(adminCaseDto.parse((await get(host.token, `/api/admin/cases/${caseId}`)).json()).isSelf).toBe(
      true,
    );
    const own = await resolve(host.token, caseId, { decision: 'reports_dismissed' });
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ code: 'self_moderation' });
    expect((await get(mod.token, `/api/admin/cases/${crypto.randomUUID()}`)).json()).toMatchObject({
      code: 'case_not_found',
    });
  });

  it('«Жалобы не подтвердились» lifts the ban this case set; a repeat or a wrong decision is refused', async () => {
    const { host, lobby, caseId } = await reportedHost();
    const mod = await moderator();
    const mismatch = await resolve(mod.token, caseId, { decision: 'meetup_held' });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ code: 'decision_mismatch' });

    const done = await resolve(mod.token, caseId, { decision: 'reports_dismissed', comment: 'Обычный клуб' });
    expect(done.statusCode, done.body).toBe(200);
    expect(adminCaseDto.parse(done.json())).toMatchObject({
      status: 'resolved',
      decision: 'reports_dismissed',
      decisionComment: 'Обычный клуб',
      resolvedBy: { id: mod.user.id },
      subject: { isShadowBanned: false },
    });
    const repeat = await resolve(mod.token, caseId, { decision: 'reports_confirmed' });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json()).toMatchObject({ code: 'case_resolved' });
    expect((await logOf(host.user.id)).map((e) => [e.action, e.actorId])).toEqual([
      ['auto_shadow_ban', null],
      ['resolve_case', mod.user.id],
      ['lift_shadow_ban', mod.user.id],
    ]);

    // New reports start a new case from zero.
    const next = await reporter();
    await post(next.token, `/api/lobbies/${lobby.id}/reports`, { reason: 'promo' });
    const open = await t.db
      .select()
      .from(moderationCases)
      .where(and(eq(moderationCases.subjectId, host.user.id), isNull(moderationCases.resolvedAt)));
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(caseId);
    expect((await userRow(host.user.id)).isShadowBanned).toBe(false);
  });

  it('«Нарушение подтверждено» keeps the ban, cancels upcoming lobbies without a penalty, can block creation', async () => {
    const { host, lobby, caseId } = await reportedHost();
    const member = await t.loginOnboarded();
    const full = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 30, slots: 1 });
    await setMembership(t.db, full.id, member.user.id, 'approved');
    await setMembership(t.db, lobby.id, member.user.id, 'pending');
    const started = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -10 });
    const mod = await moderator();

    const response = await resolve(mod.token, caseId, { decision: 'reports_confirmed', blockCreation: true });
    expect(response.statusCode, response.body).toBe(200);
    expect(adminCaseDto.parse(response.json())).toMatchObject({
      upcomingLobbies: 0,
      subject: { isShadowBanned: true, creationBlock: 'moderation' },
      block: { kind: 'moderation', lobby: null, karmaDelta: null },
    });
    const rows = await t.db
      .select({ id: lobbies.id, status: lobbies.status, reason: lobbies.cancelReason })
      .from(lobbies)
      .where(eq(lobbies.hostId, host.user.id));
    expect(new Map(rows.map((r) => [r.id, [r.status, r.reason]]))).toEqual(
      new Map([
        [lobby.id, ['cancelled', 'moderation']],
        [full.id, ['cancelled', 'moderation']],
        [started.id, ['open', null]],
      ]),
    );
    expect(await karmaEventsOf(t.db, host.user.id)).toEqual([]);
    const sent = await t.db
      .select({ lobbyId: notifications.lobbyId })
      .from(notifications)
      .where(and(eq(notifications.userId, member.user.id), eq(notifications.kind, 'member_lobby_cancelled')));
    expect(sent.map((n) => n.lobbyId).sort()).toEqual([lobby.id, full.id].sort());
    const detail = lobbyDetailDto.parse((await get(member.token, `/api/lobbies/${full.id}`)).json());
    expect(detail).toMatchObject({ status: 'cancelled', cancelReason: 'moderation', cancelComment: null });
    expect((await logOf(host.user.id)).map((e) => e.action)).toEqual([
      'auto_shadow_ban',
      'resolve_case',
      'cancel_lobby',
      'cancel_lobby',
      'block_creation',
    ]);
  });

  it('«Организатор сорвал встречу» takes back the hosted award, blocks creation and returns no-shows', async () => {
    const host = await t.loginOnboarded();
    const [absent, present] = [await t.loginOnboarded(), await t.loginOnboarded()];
    const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -300 });
    await setMembership(t.db, lobby.id, absent.user.id, 'no_show');
    await setMembership(t.db, lobby.id, present.user.id, 'attended');
    await addKarmaEvent(t.db, host.user.id, 'hosted', { lobbyId: lobby.id, delta: KARMA.HOSTED });
    await addKarmaEvent(t.db, absent.user.id, 'no_show', { lobbyId: lobby.id });
    await addKarmaEvent(t.db, present.user.id, 'attended', { lobbyId: lobby.id });
    const caseId = await openCase('not_held', host.user.id, { lobbyId: lobby.id });
    const mod = await moderator();

    const before = adminCaseDto.parse((await get(mod.token, `/api/admin/cases/${caseId}`)).json());
    expect(before.lobby).toMatchObject({ status: 'finished', hostedDelta: KARMA.HOSTED });
    expect(before.lobby!.members.map((m) => [m.user.id, m.status, m.karmaDelta])).toEqual(
      expect.arrayContaining([
        [absent.user.id, 'no_show', KARMA.NO_SHOW],
        [present.user.id, 'attended', KARMA.ATTENDED],
      ]),
    );

    // Two moderators at once: one decision, karma once.
    const other = await moderator();
    const both = await Promise.all([
      resolve(mod.token, caseId, { decision: 'host_flaked' }),
      resolve(other.token, caseId, { decision: 'host_flaked' }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);

    const hostEvents = await karmaEventsOf(t.db, host.user.id, lobby.id);
    expect(hostEvents.map((e) => [e.reason, e.delta])).toEqual([
      ['hosted', KARMA.HOSTED],
      ['moderation', KARMA.HOST_LATE_CANCEL - KARMA.HOSTED],
    ]);
    const hostRow = await userRow(host.user.id);
    expect(hostRow.karma).toBe(KARMA.START + KARMA.HOST_LATE_CANCEL);
    expect(hostRow).toMatchObject({
      lobbyCreationBlocked: true,
      creationBlockedReason: 'moderation',
      creationBlockedLobbyId: lobby.id,
    });
    const refunded = await karmaEventsOf(t.db, absent.user.id, lobby.id);
    expect(refunded.at(-1)).toMatchObject({
      reason: 'moderation',
      delta: Math.abs(KARMA.NO_SHOW),
      comment: 'Неявка снята модератором',
    });
    expect((await userRow(absent.user.id)).karma).toBe(KARMA.START);
    expect(await karmaEventsOf(t.db, present.user.id, lobby.id)).toHaveLength(1);
  });

  it('«Встреча состоялась» changes nothing; a host without the hosted award loses HOST_LATE_CANCEL', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -300 });
    const mod = await moderator();
    const held = await openCase('not_held', host.user.id, { lobbyId: lobby.id });
    expect((await resolve(mod.token, held, { decision: 'meetup_held' })).statusCode).toBe(200);
    expect(await karmaEventsOf(t.db, host.user.id)).toEqual([]);
    expect((await userRow(host.user.id)).lobbyCreationBlocked).toBe(false);

    const flaked = await openCase('not_held', host.user.id, { lobbyId: lobby.id });
    expect((await resolve(mod.token, flaked, { decision: 'host_flaked' })).statusCode).toBe(200);
    expect((await karmaEventsOf(t.db, host.user.id)).map((e) => e.delta)).toEqual([KARMA.HOST_LATE_CANCEL]);
  });

  it('an approved appeal lifts the block and gives the penalty back once; a rejection needs a reason', async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
    await addKarmaEvent(t.db, host.user.id, 'host_late_cancel', {
      lobbyId: lobby.id,
      delta: KARMA.HOST_LATE_CANCEL,
    });
    await t.db
      .update(users)
      .set(creationBlock('late_cancel', new Date(), lobby.id))
      .where(eq(users.id, host.user.id));
    const mod = await moderator();

    const rejected = await openCase('appeal', host.user.id, { lobbyId: lobby.id });
    const noReason = await resolve(mod.token, rejected, { decision: 'appeal_rejected' });
    expect(noReason.statusCode).toBe(400);
    const rejection = await resolve(mod.token, rejected, {
      decision: 'appeal_rejected',
      comment: 'Отмена без причины',
    });
    expect(rejection.statusCode).toBe(200);
    expect((await userRow(host.user.id)).lobbyCreationBlocked).toBe(true);

    const appeal = await openCase('appeal', host.user.id, { lobbyId: lobby.id });
    const before = adminCaseDto.parse((await get(mod.token, `/api/admin/cases/${appeal}`)).json());
    expect(before).toMatchObject({
      refund: Math.abs(KARMA.HOST_LATE_CANCEL),
      block: {
        kind: 'late_cancel',
        karmaDelta: KARMA.HOST_LATE_CANCEL,
        lobby: { title: 'Тестовая встреча' },
      },
      lobby: { id: lobby.id, status: 'cancelled' },
    });
    const approved = await resolve(mod.token, appeal, { decision: 'appeal_approved', refundKarma: true });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(adminCaseDto.parse(approved.json())).toMatchObject({ block: null, refund: 0 });
    expect(await userRow(host.user.id)).toMatchObject({
      karma: KARMA.START,
      lobbyCreationBlocked: false,
      creationBlockedReason: null,
    });
    expect((await karmaEventsOf(t.db, host.user.id, lobby.id)).map((e) => e.reason)).toEqual([
      'host_late_cancel',
      'appeal_refund',
    ]);
  });

  it('a moderator cancels an open lobby without a penalty; not a started, cancelled or own one', async () => {
    const host = await t.loginOnboarded();
    const member = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: 30, slots: 1 });
    await setMembership(t.db, lobby.id, member.user.id, 'approved');
    const mod = await moderator();

    const response = await post(mod.token, `/api/admin/lobbies/${lobby.id}/cancel`, { comment: 'Мошенник' });
    expect(response.statusCode, response.body).toBe(200);
    assertNoExactPlace(response.json(), 'moderator cancel');
    expect(response.json()).toMatchObject({ lobby: { status: 'cancelled', cancelReason: 'moderation' } });
    expect(await karmaEventsOf(t.db, host.user.id)).toEqual([]);
    expect((await userRow(host.user.id)).lobbyCreationBlocked).toBe(false);
    expect(
      await t.db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.userId, member.user.id), eq(notifications.kind, 'member_lobby_cancelled')),
        ),
    ).toHaveLength(1);
    expect(await logOf(host.user.id)).toEqual([
      expect.objectContaining({
        action: 'cancel_lobby',
        actorId: mod.user.id,
        lobbyId: lobby.id,
        comment: 'Мошенник',
      }),
    ]);

    const again = await post(mod.token, `/api/admin/lobbies/${lobby.id}/cancel`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'lobby_cancelled' });
    const started = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -5 });
    expect((await post(mod.token, `/api/admin/lobbies/${started.id}/cancel`, {})).json()).toMatchObject({
      code: 'lobby_started',
    });
    const own = await insertLobby(t.db, { hostId: mod.user.id });
    expect((await post(mod.token, `/api/admin/lobbies/${own.id}/cancel`, {})).json()).toMatchObject({
      code: 'self_moderation',
    });
    expect((await post(mod.token, `/api/admin/lobbies/${crypto.randomUUID()}/cancel`, {})).statusCode).toBe(
      404,
    );
  });
});
