import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, type TestDatabase } from '@masl/db/testing';
import { INTERESTS, KARMA, type AuthResponse, type MeDto } from '@masl/shared';
import { createApp } from '../src/app.factory.js';
import { loadEnv } from '../src/config/env.js';
import { signInitData } from './init-data.helper.js';

const adminUrl = process.env.TEST_DATABASE_URL;
const BOT_TOKEN = '123456789:AAE-e2e-token_for-masl';
const WEB_ORIGIN = 'https://masl.example';

describe.skipIf(!adminUrl)('API e2e (нужен TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: testDb.url,
      BOT_TOKEN,
      JWT_SECRET: 'e2e-secret-'.repeat(4),
      WEB_ORIGINS: WEB_ORIGIN,
    });
    app = await createApp(env, { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.drop();
  });

  const login = async (user: { id: number; first_name: string; username?: string }, authDate?: Date) => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: { initData: signInitData(BOT_TOKEN, user, { authDate }) },
    });
    expect(response.statusCode).toBe(200);
    return response.json<AuthResponse>();
  };

  it('GET /health отвечает ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /interests отдаёт справочник, синхронизированный при старте', async () => {
    const response = await app.inject({ method: 'GET', url: '/interests' });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((i: { slug: string }) => i.slug)).toEqual(INTERESTS.map((i) => i.slug));
  });

  it('без токена /me недоступен', async () => {
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    const badToken = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer nope' },
    });
    expect(badToken.statusCode).toBe(401);
  });

  it('отклоняет поддельную initData и пустое тело', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      payload: { initData: signInitData('1:wrong-bot', { id: 1, first_name: 'X' }) },
    });
    expect(forged.statusCode).toBe(401);

    const empty = await app.inject({ method: 'POST', url: '/auth/telegram', payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('первый вход создаёт пользователя со стартовой кармой, повторный обновляет профиль', async () => {
    const first = await login({ id: 4242, first_name: 'Аня', username: 'anya' });
    expect(first.token).toEqual(expect.any(String));
    expect(first.user).toMatchObject<Partial<MeDto>>({
      telegramId: 4242,
      firstName: 'Аня',
      username: 'anya',
      karma: KARMA.START,
      onboarded: false,
      interests: [],
    });

    const second = await login({ id: 4242, first_name: 'Анна', username: 'anna' });
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.firstName).toBe('Анна');
    expect(second.user.username).toBe('anna');
  });

  it('вход по более старой initData не откатывает профиль', async () => {
    await login({ id: 6363, first_name: 'Оля', username: 'olya_new' });
    const stale = await login(
      { id: 6363, first_name: 'Оля', username: 'olya_old' },
      new Date(Date.now() - 3600_000),
    );
    expect(stale.user.username).toBe('olya_new');
  });

  it('онбординг сохраняет пол, возраст и интересы', async () => {
    const { token } = await login({ id: 5151, first_name: 'Иван' });
    const auth = { authorization: `Bearer ${token}` };

    const tooFew = await app.inject({
      method: 'PUT',
      url: '/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 27, interests: ['sport', 'bars'] },
    });
    expect(tooFew.statusCode).toBe(400);

    const unknownInterest = await app.inject({
      method: 'PUT',
      url: '/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 27, interests: ['sport', 'bars', 'hacking'] },
    });
    expect(unknownInterest.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: '/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 27, interests: ['sport', 'networking', 'boardgames'] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<MeDto>()).toMatchObject({
      gender: 'male',
      age: 27,
      onboarded: true,
      interests: ['boardgames', 'networking', 'sport'],
    });

    // Повторный онбординг заменяет интересы, а не добавляет.
    const again = await app.inject({
      method: 'PUT',
      url: '/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 28, interests: ['food', 'bars', 'music'] },
    });
    expect(again.json<MeDto>().interests).toEqual(['bars', 'food', 'music']);

    const me = await app.inject({ method: 'GET', url: '/me', headers: auth });
    expect(me.json<MeDto>()).toMatchObject({
      age: 28,
      onboarded: true,
      interests: ['bars', 'food', 'music'],
    });
  });

  it('CORS разрешает только адрес Mini App', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/me',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
