import { eq } from 'drizzle-orm';
import { lobbies } from '@masl/db';
import {
  HOSTED_UPCOMING_MAX,
  LOBBIES_PER_DAY_MAX,
  RATE_LIMITS,
  apiErrorDto,
  formatMoscowTime,
  type ApiErrorDto,
} from '@masl/shared';
import { addKarmaEvent, adminUrl, bootApp, setUser, shiftCreatedAt, type TestApp } from './helpers.js';

const DAY_MS = 24 * 3600_000;

describe.skipIf(!adminUrl)('lobby creation limits e2e (requires TEST_DATABASE_URL)', () => {
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

  const createdAtOf = async (lobbyId: string) => {
    const [row] = await t.db
      .select({ createdAt: lobbies.createdAt })
      .from(lobbies)
      .where(eq(lobbies.id, lobbyId));
    return row!.createdAt;
  };

  const hostedCount = async (hostId: string) =>
    (await t.db.select({ id: lobbies.id }).from(lobbies).where(eq(lobbies.hostId, hostId))).length;

  it('T-ABUSE-1: a newbie gets one lobby per rolling 24 h, with retryAt in Moscow time', async () => {
    const host = await t.loginOnboarded();
    const first = await t.createLobby(host.token);
    expect(first.statusCode).toBe(201);

    const second = await t.createLobby(host.token);
    expect(second.statusCode).toBe(429);
    const body = second.json<ApiErrorDto>();
    expect(apiErrorDto.safeParse(body).success).toBe(true);
    const retryAt = new Date((await createdAtOf(first.json().id)).getTime() + DAY_MS);
    expect(body.code).toBe('daily_limit');
    expect(body.retryAt).toBe(retryAt.toISOString());
    // The limit lifts at the next whole minute after retryAt; the message names it in Moscow time.
    const shown = new Date(Math.ceil(retryAt.getTime() / 60_000) * 60_000);
    expect(body.message).toBe(
      `Новичкам доступна одна встреча в сутки. Следующую можно создать завтра после ${formatMoscowTime(shown)} (по Москве)`,
    );
    expect(await hostedCount(host.user.id)).toBe(1);
  });

  it('T-ABUSE-1: a cancelled lobby still counts; 25 h later the newbie can create again', async () => {
    const host = await t.loginOnboarded();
    const first = await t.createLobby(host.token);
    const now = new Date();
    await t.db
      .update(lobbies)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: 'plans_changed' })
      .where(eq(lobbies.id, first.json().id));
    expect((await t.createLobby(host.token)).json()).toMatchObject({ code: 'daily_limit' });

    await shiftCreatedAt(t.db, 'lobbies', first.json().id, -25);
    expect((await t.createLobby(host.token)).statusCode).toBe(201);
  });

  it(`T-ABUSE-2: after an attended meetup, ${LOBBIES_PER_DAY_MAX} per day and ${HOSTED_UPCOMING_MAX} upcoming`, async () => {
    const host = await t.loginOnboarded();
    await addKarmaEvent(t.db, host.user.id, 'attended');
    const ids: string[] = [];
    for (let i = 0; i < LOBBIES_PER_DAY_MAX; i++) {
      const response = await t.createLobby(host.token);
      expect(response.statusCode, `lobby ${i + 1}`).toBe(201);
      ids.push(response.json().id);
    }
    const fourth = await t.createLobby(host.token);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toMatchObject({ code: 'daily_limit' });
    expect(fourth.json().message).toMatch(
      new RegExp(
        `^Можно создавать не больше ${LOBBIES_PER_DAY_MAX} встреч в сутки\\. Следующую — .+ \\(по Москве\\)$`,
      ),
    );
    expect(fourth.json().retryAt).toBe(
      new Date((await createdAtOf(ids[0]!)).getTime() + DAY_MS).toISOString(),
    );

    // Out of the daily window, but still upcoming: the upcoming cap takes over.
    for (const id of ids) await shiftCreatedAt(t.db, 'lobbies', id, -25);
    for (let i = ids.length; i < HOSTED_UPCOMING_MAX; i++) {
      expect((await t.createLobby(host.token)).statusCode, `lobby ${i + 1}`).toBe(201);
    }
    const over = await t.createLobby(host.token);
    expect(over.statusCode).toBe(429);
    expect(over.json()).toEqual({
      statusCode: 429,
      code: 'upcoming_limit',
      message: `У вас уже ${HOSTED_UPCOMING_MAX} предстоящих встреч. Дождитесь их или отмените одну`,
    });

    // A cancelled lobby is not upcoming any more.
    await t.db
      .update(lobbies)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(lobbies.id, ids[0]!));
    expect((await t.createLobby(host.token)).statusCode).toBe(201);
  });

  it('T-ABUSE-3 (create): a blocked user gets 403 creation_blocked', async () => {
    const host = await t.loginOnboarded();
    await setUser(t.db, host.user.id, { lobbyCreationBlocked: true });
    const response = await t.createLobby(host.token);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      statusCode: 403,
      code: 'creation_blocked',
      message: 'Создание встреч приостановлено. Обжаловать можно будет позже',
    });
    expect(await hostedCount(host.user.id)).toBe(0);
  });

  it('T-ABUSE-7 (create): a user who has not finished onboarding gets 403 not_onboarded', async () => {
    const user = await t.login();
    const response = await t.createLobby(user.token);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      statusCode: 403,
      code: 'not_onboarded',
      message: 'Сначала заполните профиль',
    });

    // Checked fresh from the database, not from the session.
    const onboarded = await t.loginOnboarded();
    await setUser(t.db, onboarded.user.id, { onboardedAt: null });
    expect((await t.createLobby(onboarded.token)).statusCode).toBe(403);
  });

  it('T-RACE-3: parallel creates by a newbie with different requestIds make one lobby', async () => {
    const host = await t.loginOnboarded();
    const responses = await Promise.all([1, 2, 3, 4].map(() => t.createLobby(host.token)));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 429, 429, 429]);
    expect(await hostedCount(host.user.id)).toBe(1);
  });

  it('rate limits creates per user (lobbyWrite)', async () => {
    const host = await t.loginOnboarded();
    for (let i = 0; i < RATE_LIMITS.lobbyWrite.limit; i++) {
      expect((await t.createLobby(host.token, { title: 'аб' })).statusCode).toBe(400);
    }
    const limited = await t.createLobby(host.token);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
