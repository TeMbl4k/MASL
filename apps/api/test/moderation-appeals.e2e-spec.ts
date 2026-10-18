import { eq } from 'drizzle-orm';
import { moderationCases, users } from '@masl/db';
import {
  APPEAL_RETRY_DAYS,
  KARMA,
  appealStateDto,
  creationContextDto,
  type AuthResponse,
} from '@masl/shared';
import { creationBlock } from '../src/users/creation-block.js';
import {
  addKarmaEvent,
  adminUrl,
  authHeader,
  bootApp,
  insertLobby,
  setUser,
  shiftCreatedAt,
  type TestApp,
} from './helpers.js';

const DAY_MS = 86_400_000;
const APPEAL = 'Клуб отменил бронь корта за час до игры, вот письмо от администратора.';

describe.skipIf(!adminUrl)('appeals against a creation block e2e (requires TEST_DATABASE_URL)', () => {
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

  const get = (token: string, url: string) =>
    t.app.inject({ method: 'GET', url, headers: authHeader(token) });
  const post = (token: string, url: string, payload: object) =>
    t.app.inject({ method: 'POST', url, headers: authHeader(token), payload });
  const state = async (token: string) => appealStateDto.parse((await get(token, '/api/me/appeal')).json());
  const appeal = (token: string, text = APPEAL) => post(token, '/api/me/appeals', { text });
  /** A host blocked after a late cancel of a full lobby, as stage 3 leaves them. */
  const lateCanceller = async () => {
    const host = await t.loginOnboarded();
    const lobby = await insertLobby(t.db, { hostId: host.user.id, status: 'cancelled', title: 'Падел' });
    // Created days ago, so the daily limit doesn't get in the way.
    await shiftCreatedAt(t.db, 'lobbies', lobby.id, -48);
    await addKarmaEvent(t.db, host.user.id, 'host_late_cancel', {
      lobbyId: lobby.id,
      delta: KARMA.HOST_LATE_CANCEL,
    });
    await t.db
      .update(users)
      .set(creationBlock('late_cancel', new Date(), lobby.id))
      .where(eq(users.id, host.user.id));
    return { host, lobby };
  };
  const moderator = async (): Promise<AuthResponse> => {
    const auth = await t.loginOnboarded();
    await setUser(t.db, auth.user.id, { isModerator: true });
    return auth;
  };
  const appealCase = async (userId: string) =>
    (await t.db.select().from(moderationCases).where(eq(moderationCases.subjectId, userId)))
      .filter((c) => c.kind === 'appeal')
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())[0]!;

  it('a user without a block has nothing to appeal', async () => {
    const user = await t.loginOnboarded();
    expect(await state(user.token)).toEqual({ block: null, appeal: null, retryAt: null, canAppeal: false });
    const response = await appeal(user.token);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      statusCode: 409,
      code: 'not_blocked',
      message: 'Создание встреч не заблокировано, обжаловать нечего',
    });
  });

  it('shows the block by kind and takes one appeal at a time; another user sees only their own', async () => {
    const { host, lobby } = await lateCanceller();
    const before = await state(host.token);
    expect(before).toMatchObject({
      block: { kind: 'late_cancel', karmaDelta: KARMA.HOST_LATE_CANCEL, lobby: { title: 'Падел' } },
      appeal: null,
      canAppeal: true,
    });
    const context = creationContextDto.parse((await get(host.token, '/api/lobbies/creation-context')).json());
    expect(context).toMatchObject({ reason: 'blocked', blockKind: 'late_cancel' });
    expect((await t.createLobby(host.token)).json()).toMatchObject({
      code: 'creation_blocked',
      message: 'Создание встреч заблокировано после отмены в последний час. Подать апелляцию можно в профиле',
    });

    expect((await appeal(host.token, 'Коротко')).statusCode).toBe(400);
    const sent = await appeal(host.token);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(appealStateDto.parse(sent.json())).toMatchObject({
      appeal: { status: 'open', decidedAt: null, comment: null },
      canAppeal: false,
    });
    expect(await appealCase(host.user.id)).toMatchObject({ lobbyId: lobby.id, appealText: APPEAL });
    const again = await appeal(host.token);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'appeal_open' });

    const other = await t.loginOnboarded();
    expect(await state(other.token)).toEqual({ block: null, appeal: null, retryAt: null, canAppeal: false });
  });

  it(`after a rejection shows the reason and allows the next appeal in ${APPEAL_RETRY_DAYS} days`, async () => {
    const { host } = await lateCanceller();
    await appeal(host.token);
    const mod = await moderator();
    const kase = await appealCase(host.user.id);
    expect(
      (
        await post(mod.token, `/api/admin/cases/${kase.id}/resolve`, {
          decision: 'appeal_rejected',
          comment: 'Отмена без уважительной причины',
        })
      ).statusCode,
    ).toBe(200);

    const rejected = await state(host.token);
    const decidedAt = Date.parse(rejected.appeal!.decidedAt!);
    expect(rejected).toMatchObject({
      appeal: { status: 'rejected', comment: 'Отмена без уважительной причины' },
      retryAt: new Date(decidedAt + APPEAL_RETRY_DAYS * DAY_MS).toISOString(),
      canAppeal: false,
    });
    const tooSoon = await appeal(host.token);
    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.json()).toMatchObject({ code: 'appeal_too_soon', retryAt: rejected.retryAt });

    await t.db
      .update(moderationCases)
      .set({ resolvedAt: new Date(Date.now() - (APPEAL_RETRY_DAYS + 1) * DAY_MS) })
      .where(eq(moderationCases.id, kase.id));
    expect((await state(host.token)).canAppeal).toBe(true);
    expect((await appeal(host.token)).statusCode).toBe(200);
  });

  it('an approved appeal lifts the block; a moderator block reads as such', async () => {
    const { host } = await lateCanceller();
    await appeal(host.token);
    const mod = await moderator();
    const kase = await appealCase(host.user.id);
    await post(mod.token, `/api/admin/cases/${kase.id}/resolve`, { decision: 'appeal_approved' });
    expect(await state(host.token)).toMatchObject({
      block: null,
      appeal: { status: 'approved', comment: null },
      retryAt: null,
      canAppeal: false,
    });
    expect((await t.createLobby(host.token)).statusCode).toBe(201);

    await post(mod.token, `/api/admin/users/${host.user.id}/actions`, { action: 'block_creation' });
    expect((await state(host.token)).block).toMatchObject({
      kind: 'moderation',
      lobby: null,
      karmaDelta: null,
    });
    const context = creationContextDto.parse((await get(host.token, '/api/lobbies/creation-context')).json());
    expect(context.blockKind).toBe('moderation');
    expect((await t.createLobby(host.token)).json()).toMatchObject({
      message: 'Создание встреч заблокировано решением модерации. Подать апелляцию можно в профиле',
    });
  });
});
