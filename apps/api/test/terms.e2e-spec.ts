import { eq } from 'drizzle-orm';
import { users } from '@masl/db';
import { TERMS_VERSION, meDto, type MeDto } from '@masl/shared';
import { adminUrl, authHeader, bootApp, type TestApp } from './helpers.js';

describe.skipIf(!adminUrl)('user agreement e2e (requires TEST_DATABASE_URL)', () => {
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

  const putTerms = (token: string, payload: object) =>
    t.app.inject({ method: 'PUT', url: '/api/me/terms', headers: authHeader(token), payload });
  const me = async (token: string) =>
    meDto.parse((await t.app.inject({ method: 'GET', url: '/api/me', headers: authHeader(token) })).json());
  const termsRow = async (userId: string) => {
    const [row] = await t.db
      .select({ version: users.termsVersion, acceptedAt: users.termsAcceptedAt })
      .from(users)
      .where(eq(users.id, userId));
    return row!;
  };

  it('a new user has not accepted the agreement and cannot onboard before accepting it', async () => {
    const user = await t.login();
    expect(user.user.termsAccepted).toBe(false);

    const response = await t.app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: authHeader(user.token),
      payload: { gender: 'male', age: 30, interests: ['sport', 'bars', 'music'] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      statusCode: 403,
      code: 'terms_not_accepted',
      message: 'Сначала примите пользовательское соглашение',
    });
    expect(await me(user.token)).toMatchObject<Partial<MeDto>>({ gender: null, age: null, onboarded: false });
  });

  it('accepting stores the version and the time; a repeat keeps the first acceptance', async () => {
    const user = await t.login();
    const accepted = await putTerms(user.token, { version: TERMS_VERSION });
    expect(accepted.statusCode).toBe(200);
    expect(meDto.parse(accepted.json()).termsAccepted).toBe(true);
    const first = await termsRow(user.user.id);
    expect(first.version).toBe(TERMS_VERSION);
    expect(first.acceptedAt).toBeInstanceOf(Date);

    expect((await putTerms(user.token, { version: TERMS_VERSION })).statusCode).toBe(200);
    expect((await termsRow(user.user.id)).acceptedAt).toEqual(first.acceptedAt);
  });

  it('another version answers 409 and a malformed one 400; nothing is stored', async () => {
    const user = await t.login();
    const outdated = await putTerms(user.token, { version: TERMS_VERSION + 1 });
    expect(outdated.statusCode).toBe(409);
    expect(outdated.json()).toMatchObject({ code: 'terms_outdated' });
    for (const payload of [{}, { version: 0 }, { version: '1' }, { version: 1.5 }]) {
      expect((await putTerms(user.token, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(await termsRow(user.user.id)).toEqual({ version: null, acceptedAt: null });
  });

  it('T-IDOR: user B accepts only for themselves, whatever the body says', async () => {
    const a = await t.login();
    const b = await t.login();
    const response = await putTerms(b.token, { version: TERMS_VERSION, userId: a.user.id, id: a.user.id });
    expect(response.statusCode).toBe(200);
    expect(meDto.parse(response.json()).id).toBe(b.user.id);
    expect(await termsRow(a.user.id)).toEqual({ version: null, acceptedAt: null });
  });

  it('after a new version the server refuses actions until the user accepts it again', async () => {
    const user = await t.loginOnboarded();
    await t.db
      .update(users)
      .set({ termsVersion: TERMS_VERSION - 1 })
      .where(eq(users.id, user.user.id));

    expect(await me(user.token)).toMatchObject<Partial<MeDto>>({ onboarded: true, termsAccepted: false });
    const interests = await t.app.inject({
      method: 'PUT',
      url: '/api/me/interests',
      headers: authHeader(user.token),
      payload: { interests: ['music', 'cinema', 'walks'] },
    });
    expect(interests.statusCode).toBe(403);
    expect(interests.json()).toMatchObject({ code: 'terms_not_accepted' });
    expect((await t.createLobby(user.token)).statusCode).toBe(403);

    expect((await putTerms(user.token, { version: TERMS_VERSION })).statusCode).toBe(200);
    expect((await t.createLobby(user.token)).statusCode).toBe(201);
  });
});
