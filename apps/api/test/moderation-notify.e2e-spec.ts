import { and, eq, sql } from 'drizzle-orm';
import { moderationCases, notifications, users } from '@masl/db';
import { APPEAL_RETRY_DAYS, KARMA, formatMoscow, type AuthResponse } from '@masl/shared';
import { FeedbackService } from '../src/lobbies/feedback.service.js';
import { creationBlock } from '../src/users/creation-block.js';
import {
  addKarmaEvent,
  adminUrl,
  authHeader,
  bootApp,
  freshTelegramId,
  insertLobby,
  setMembership,
  setUser,
  shiftCreatedAt,
  type TestApp,
} from './helpers.js';

const DAY_MS = 86_400_000;
const APPEAL = 'Клуб отменил бронь корта за час до игры, вот письмо от администратора.';

describe.skipIf(!adminUrl)('moderation bot messages e2e (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  const adminTelegramId = freshTelegramId();

  beforeAll(async () => {
    t = await bootApp({ env: { ADMIN_TELEGRAM_IDS: String(adminTelegramId) } });
  });

  afterAll(async () => {
    await t?.close();
  });

  beforeEach(async () => {
    t.resetRateLimits();
    // Earlier tests' moderators would get these messages too.
    await t.db.update(users).set({ isModerator: false });
    await t.flushOutbox();
    t.telegram.reset();
  });

  const post = (token: string, url: string, payload: object) =>
    t.app.inject({ method: 'POST', url, headers: authHeader(token), payload });
  const writable = async (auth: AuthResponse) => {
    await t.db.update(users).set({ allowsWriteToPm: true }).where(eq(users.id, auth.user.id));
    return auth;
  };
  const moderator = async (): Promise<AuthResponse> => {
    const auth = await writable(await t.loginOnboarded());
    await setUser(t.db, auth.user.id, { isModerator: true });
    return auth;
  };
  const reporter = async (): Promise<AuthResponse> => {
    const auth = await writable(await t.loginOnboarded(undefined, 'Доносчик'));
    await t.db
      .update(users)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(users.id, auth.user.id));
    return auth;
  };
  const textsTo = (auth: AuthResponse) => t.telegram.textsTo(auth.user.telegramId);

  it('tells moderators and admins about an automatic shadow ban once, without the reporters', async () => {
    const [mod, silent, admin, user] = [
      await moderator(),
      await t.loginOnboarded(),
      await writable(await t.loginOnboarded(adminTelegramId)),
      await writable(await t.loginOnboarded()),
    ];
    await setUser(t.db, silent.user.id, { isModerator: true });
    const host = await moderator();
    await t.db.update(users).set({ firstName: 'Иван' }).where(eq(users.id, host.user.id));
    const lobby = await insertLobby(t.db, { hostId: host.user.id });
    for (const reason of ['scam', 'promo', 'scam']) {
      const r = await reporter();
      await post(r.token, `/api/lobbies/${lobby.id}/reports`, { reason, comment: 'Просит предоплату' });
    }
    // Once banned, the lobby is hidden: a later report is a 404 and changes nothing.
    const late = await reporter();
    await post(late.token, `/api/lobbies/${lobby.id}/reports`, { reason: 'abuse' });
    await t.flushOutbox();

    const expected = 'Теневой бан для Иван. Жалоб: 3 (реклама или промо, мошенничество).';
    expect(textsTo(mod)).toEqual([expected]);
    expect(textsTo(admin)).toEqual([expected]);
    // No write access, not a moderator, or the subject: nothing.
    expect(textsTo(silent)).toEqual([]);
    expect(textsTo(user)).toEqual([]);
    expect(textsTo(host)).toEqual([]);
    expect(textsTo(late)).toEqual([]);
    for (const call of t.telegram.sent('sendMessage')) {
      expect(call.payload.parse_mode).toBeUndefined();
      expect(String(call.payload.text)).not.toMatch(/Доносчик|предоплат/);
    }
  });

  it('drops the message for a moderator revoked before it went out, and for a decided case', async () => {
    const [kept, revoked] = [await moderator(), await moderator()];
    const host = await writable(await t.loginOnboarded());
    const lobby = await insertLobby(t.db, { hostId: host.user.id, startsInMin: -300, title: 'Настолки' });
    const members = [await t.loginOnboarded(), await t.loginOnboarded()];
    for (const m of members) await setMembership(t.db, lobby.id, m.user.id, 'attended');
    const feedback = t.app.get(FeedbackService);
    expect(await feedback.record(members[0]!.user.id, lobby.id, 'not_held')).toBe('recorded');
    expect(await feedback.record(members[1]!.user.id, lobby.id, 'not_held')).toBe('recorded');
    await setUser(t.db, revoked.user.id, { isModerator: false });
    await t.flushOutbox();
    expect(textsTo(kept)).toEqual(['Встреча «Настолки» могла не состояться: так ответил участник.']);
    expect(textsTo(revoked)).toEqual([]);

    const appellant = await writable(await t.loginOnboarded());
    await t.db
      .update(users)
      .set(creationBlock('moderation', new Date(), null))
      .where(eq(users.id, appellant.user.id));
    await post(appellant.token, '/api/me/appeals', { text: APPEAL });
    await t.db
      .update(moderationCases)
      .set({ resolvedAt: new Date(), decision: 'appeal_rejected', decisionComment: 'нет' })
      .where(and(eq(moderationCases.subjectId, appellant.user.id), eq(moderationCases.kind, 'appeal')));
    await t.flushOutbox();
    expect(textsTo(kept)).toHaveLength(1);
  });

  it('tells the author how the appeal ended, in plain text', async () => {
    const mod = await moderator();
    const host = await writable(await t.loginOnboarded());
    await t.db.update(users).set({ firstName: 'Анна' }).where(eq(users.id, host.user.id));
    const lobby = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled' });
    await shiftCreatedAt(t.db, 'lobbies', lobby.id, -48);
    await addKarmaEvent(t.db, host.user.id, 'host_late_cancel', {
      lobbyId: lobby.id,
      delta: KARMA.HOST_LATE_CANCEL,
    });
    await t.db
      .update(users)
      .set(creationBlock('late_cancel', new Date(), lobby.id))
      .where(eq(users.id, host.user.id));

    await post(host.token, '/api/me/appeals', { text: APPEAL });
    await t.flushOutbox();
    expect(textsTo(mod)).toEqual(['Новая апелляция от Анна.']);

    const caseOf = async () =>
      (
        await t.db
          .select()
          .from(moderationCases)
          .where(eq(moderationCases.subjectId, host.user.id))
          .orderBy(moderationCases.openedAt)
      ).at(-1)!;
    const rejected = await caseOf();
    await post(mod.token, `/api/admin/cases/${rejected.id}/resolve`, {
      decision: 'appeal_rejected',
      comment: '<b>Без причины</b>',
    });
    await t.flushOutbox();
    const decidedAt = (await caseOf()).resolvedAt!;
    const retry = formatMoscow(new Date(decidedAt.getTime() + APPEAL_RETRY_DAYS * DAY_MS), {
      day: 'numeric',
      month: 'long',
    });
    expect(textsTo(host)).toEqual([`Апелляцию отклонили: <b>Без причины</b>. Повторно можно с ${retry}.`]);

    await t.db
      .update(moderationCases)
      .set({ resolvedAt: new Date(Date.now() - (APPEAL_RETRY_DAYS + 1) * DAY_MS) })
      .where(eq(moderationCases.id, rejected.id));
    await post(host.token, '/api/me/appeals', { text: APPEAL });
    const second = await caseOf();
    t.telegram.reset();
    await post(mod.token, `/api/admin/cases/${second.id}/resolve`, {
      decision: 'appeal_approved',
      refundKarma: true,
    });
    await t.flushOutbox();
    expect(textsTo(host)).toEqual([
      `Блокировку создания встреч сняли. Можно снова собирать людей.\nКарму вернули: +${Math.abs(KARMA.HOST_LATE_CANCEL)}.`,
    ]);
    for (const call of t.telegram.sent('sendMessage')) expect(call.payload.parse_mode).toBeUndefined();
  });

  it('lifting the block from the user card approves the open appeal and tells the author', async () => {
    const mod = await moderator();
    const host = await writable(await t.loginOnboarded());
    await t.db
      .update(users)
      .set(creationBlock('moderation', new Date(), null))
      .where(eq(users.id, host.user.id));
    await post(host.token, '/api/me/appeals', { text: APPEAL });
    await t.flushOutbox();
    t.telegram.reset();
    await post(mod.token, `/api/admin/users/${host.user.id}/actions`, { action: 'unblock_creation' });
    await t.flushOutbox();
    expect(textsTo(host)).toEqual(['Блокировку создания встреч сняли. Можно снова собирать людей.']);
    expect(
      await t.db
        .select({ kind: notifications.kind })
        .from(notifications)
        .where(eq(notifications.userId, host.user.id)),
    ).toEqual([{ kind: 'user_appeal_approved' }]);
  });
});
