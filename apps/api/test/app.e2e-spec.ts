import 'reflect-metadata';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestDatabase, type TestDatabase } from '@masl/db/testing';
import { INTERESTS, KARMA, TERMS_VERSION, type AuthResponse, type MeDto } from '@masl/shared';
import { createApp } from '../src/app.factory.js';
import { loadEnv } from '../src/config/env.js';
import { signInitData } from './init-data.helper.js';

const adminUrl = process.env.TEST_DATABASE_URL;
const BOT_TOKEN = '123456789:AAE-e2e-token_for-masl';
const WEB_ORIGIN = 'https://masl.example';

describe.skipIf(!adminUrl)('API e2e (requires TEST_DATABASE_URL)', () => {
  let testDb: TestDatabase;
  let app: NestFastifyApplication;
  let webDistDir: string;

  beforeAll(async () => {
    // Minimal Mini App build for the API to serve from the same origin.
    webDistDir = await mkdtemp(join(tmpdir(), 'masl-web-'));
    await mkdir(join(webDistDir, '_app', 'immutable'), { recursive: true });
    await writeFile(join(webDistDir, 'index.html'), '<!doctype html><title>MASL</title>');
    await writeFile(join(webDistDir, '_app', 'immutable', 'entry.js'), 'export {};');
    testDb = await createTestDatabase(adminUrl!);
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: testDb.url,
      BOT_TOKEN,
      JWT_SECRET: 'e2e-secret-'.repeat(4),
      WEB_ORIGINS: WEB_ORIGIN,
    });
    app = await createApp(env, { logger: false, webDistDir });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.drop();
    await rm(webDistDir, { recursive: true, force: true });
  });

  const login = async (user: { id: number; first_name: string; username?: string }, authDate?: Date) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: signInitData(BOT_TOKEN, user, { authDate }) },
    });
    expect(response.statusCode).toBe(200);
    return response.json<AuthResponse>();
  };

  it('serves the Mini App from the same origin and JSON 404 for unknown API paths', async () => {
    for (const url of ['/', '/lobby/42']) {
      const page = await app.inject({ method: 'GET', url });
      expect(page.statusCode, url).toBe(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.headers['cache-control']).toBe('no-cache');
      expect(page.body).toContain('<title>MASL</title>');
    }

    const asset = await app.inject({ method: 'GET', url: '/_app/immutable/entry.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    for (const url of ['/api/nope', '/_app/immutable/old-chunk.js', '/missing.js']) {
      const missing = await app.inject({ method: 'GET', url });
      expect(missing.statusCode, url).toBe(404);
      expect(missing.headers['content-type']).toMatch(/application\/json/);
    }
  });

  it('GET /api/health returns ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /interests returns the catalog synced on startup', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/interests' });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((i: { slug: string }) => i.slug)).toEqual(INTERESTS.map((i) => i.slug));
  });

  it('/me is unavailable without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const badToken = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer nope' },
    });
    expect(badToken.statusCode).toBe(401);
  });

  it('rejects forged initData and an empty body', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: '/api/auth/telegram',
      payload: { initData: signInitData('1:wrong-bot', { id: 1, first_name: 'X' }) },
    });
    expect(forged.statusCode).toBe(401);

    const empty = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it('first sign-in creates a user with starting karma, a repeat sign-in updates the profile', async () => {
    const first = await login({ id: 4242, first_name: 'Аня', username: 'anya' });
    expect(first.token).toEqual(expect.any(String));
    expect(first.user).toMatchObject<Partial<MeDto>>({
      telegramId: 4242,
      firstName: 'Аня',
      username: 'anya',
      karma: KARMA.START,
      onboarded: false,
      termsAccepted: false,
      interests: [],
    });

    const second = await login({ id: 4242, first_name: 'Анна', username: 'anna' });
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.firstName).toBe('Анна');
    expect(second.user.username).toBe('anna');
  });

  it('sign-in with older initData does not roll back the profile', async () => {
    await login({ id: 6363, first_name: 'Оля', username: 'olya_new' });
    const stale = await login(
      { id: 6363, first_name: 'Оля', username: 'olya_old' },
      new Date(Date.now() - 3600_000),
    );
    expect(stale.user.username).toBe('olya_new');
  });

  it('onboarding saves gender, age and interests', async () => {
    const { token } = await login({ id: 5151, first_name: 'Иван' });
    const auth = { authorization: `Bearer ${token}` };

    const tooFew = await app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 27, interests: ['sport', 'bars'] },
    });
    expect(tooFew.statusCode).toBe(400);

    const unknownInterest = await app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 27, interests: ['sport', 'bars', 'hacking'] },
    });
    expect(unknownInterest.statusCode).toBe(400);

    const terms = await app.inject({
      method: 'PUT',
      url: '/api/me/terms',
      headers: auth,
      payload: { version: TERMS_VERSION },
    });
    expect(terms.statusCode).toBe(200);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
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

    // Repeat onboarding replaces interests instead of appending to them.
    const again = await app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: auth,
      payload: { gender: 'male', age: 28, interests: ['food', 'bars', 'music'] },
    });
    expect(again.json<MeDto>().interests).toEqual(['bars', 'food', 'music']);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth });
    expect(me.json<MeDto>()).toMatchObject({
      age: 28,
      onboarded: true,
      interests: ['bars', 'food', 'music'],
    });
  });

  it('CORS allows only origins from WEB_ORIGINS', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/me',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
