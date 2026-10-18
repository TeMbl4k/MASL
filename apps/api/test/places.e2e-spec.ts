import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { RATE_LIMITS, placeReverseResponse, placeSuggestResponse } from '@masl/shared';
import { DADATA_BASE_URL } from '../src/places/dadata.client.js';
import { FixedWindowStore } from '../src/rate-limit/fixed-window.store.js';
import { adminUrl, authHeader, bootApp, CANARY_POINT, type TestApp } from './helpers.js';

const KEY = 'e2e-dadata-key-7d41b0';

/** Boots the app with the Logger captured, and returns what PlacesModule said on startup. */
async function bootCapturingLogs(env?: Record<string, string>) {
  const spy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  try {
    const t = await bootApp({ env });
    return { t, startupLogs: spy.mock.calls.map((args) => inspect(args)) };
  } finally {
    spy.mockRestore();
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe.skipIf(!adminUrl)('places e2e without a DaData key (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  let startupLogs: string[];
  // The network boundary: any call to DaData would land here, never on the real service.
  const upstream = vi.fn(async () => json({ suggestions: [] }));

  beforeAll(async () => {
    vi.stubGlobal('fetch', upstream);
    ({ t, startupLogs } = await bootCapturingLogs());
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
  });

  const suggest = (token: string, q: string) =>
    t.app.inject({
      method: 'GET',
      url: `/api/places/suggest?q=${encodeURIComponent(q)}`,
      headers: authHeader(token),
    });
  const reverse = (token: string, query: string) =>
    t.app.inject({ method: 'GET', url: `/api/places/reverse?${query}`, headers: authHeader(token) });
  const canaryQuery = `lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`;

  it('says on startup that address suggestions are off', () => {
    expect(startupLogs.join('\n')).toContain('Подсказки адресов DaData выключены: DADATA_API_KEY не задан');
  });

  it('T-DADATA-2: suggest and reverse answer enabled:false and nothing goes upstream', async () => {
    const user = await t.loginOnboarded();

    const s = await suggest(user.token, 'Тверская 1');
    expect(s.statusCode).toBe(200);
    expect(s.headers['cache-control']).toBe('private, no-store');
    expect(s.json()).toEqual({ enabled: false, degraded: false, items: [] });
    expect(placeSuggestResponse.safeParse(s.json()).success).toBe(true);

    const r = await reverse(user.token, canaryQuery);
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.json()).toEqual({ enabled: false, degraded: false, address: null });
    expect(placeReverseResponse.safeParse(r.json()).success).toBe(true);

    expect(upstream).not.toHaveBeenCalled();
  });

  it('validates the suggest query', async () => {
    const user = await t.loginOnboarded();
    for (const q of ['а', 'аб', '   а   ', 'а'.repeat(500)]) {
      const response = await suggest(user.token, q);
      expect(response.statusCode, q).toBe(400);
      expect(response.json()).toMatchObject({ message: 'Некорректные данные' });
    }
    const missing = await t.app.inject({
      method: 'GET',
      url: '/api/places/suggest',
      headers: authHeader(user.token),
    });
    expect(missing.statusCode).toBe(400);
  });

  it('validates the reverse point: Moscow only, both numbers', async () => {
    const user = await t.loginOnboarded();
    for (const query of [
      'lat=59.9358&lng=30.326', // St Petersburg
      'lat=55.75',
      'lng=37.6',
      'lat=abc&lng=37.6',
      'lat=&lng=',
      'lat=55.75&lng=37.6&lat=55.76',
    ]) {
      const response = await reverse(user.token, query);
      expect(response.statusCode, query).toBe(400);
      // The error never echoes the coordinates back.
      expect(response.body, query).not.toContain('59.9358');
    }
  });

  it('T-ABUSE-7 (places part): a user who has not finished onboarding gets 403', async () => {
    const user = await t.login();
    for (const response of [
      await suggest(user.token, 'Тверская 1'),
      await reverse(user.token, canaryQuery),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        statusCode: 403,
        code: 'not_onboarded',
        message: 'Сначала заполните профиль',
      });
    }
  });

  it(`T-ABUSE-8: the ${RATE_LIMITS.placeSuggest.limit + 1}th suggest within a minute gets 429 with Retry-After`, async () => {
    const user = await t.loginOnboarded();
    const other = await t.loginOnboarded();
    for (let i = 0; i < RATE_LIMITS.placeSuggest.limit; i++) {
      expect((await suggest(user.token, `Тверская ${i}`)).statusCode).toBe(200);
    }
    const limited = await suggest(user.token, 'Тверская 99');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMITS.placeSuggest.windowSeconds);
    // The limit is per user.
    expect((await suggest(other.token, 'Тверская 1')).statusCode).toBe(200);
  });

  it(`limits reverse to ${RATE_LIMITS.placeReverse.limit} a minute per user`, async () => {
    const user = await t.loginOnboarded();
    for (let i = 0; i < RATE_LIMITS.placeReverse.limit; i++) {
      expect((await reverse(user.token, canaryQuery)).statusCode).toBe(200);
    }
    const limited = await reverse(user.token, canaryQuery);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it(`suggest and reverse share one daily quota of ${RATE_LIMITS.placeSuggestDaily.limit} per user`, async () => {
    const user = await t.loginOnboarded();
    const other = await t.loginOnboarded();
    const daily = RATE_LIMITS.placeSuggestDaily;
    // A day's worth of address lookups but one, without waiting out the per-minute windows.
    const store = t.app.get(FixedWindowStore);
    for (let i = 0; i < daily.limit - 1; i++) {
      store.take(
        [
          {
            key: `placeSuggestDaily:${user.user.id}`,
            limit: daily.limit,
            windowMs: daily.windowSeconds * 1000,
          },
        ],
        Date.now(),
      );
    }
    expect((await reverse(user.token, canaryQuery)).statusCode).toBe(200);

    for (const limited of [await reverse(user.token, canaryQuery), await suggest(user.token, 'Тверская 1')]) {
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: 'rate_limited' });
      // The daily window, not the per-minute one, refused it.
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(RATE_LIMITS.placeReverse.windowSeconds);
    }
    expect((await reverse(other.token, canaryQuery)).statusCode).toBe(200);
  });
});

describe.skipIf(!adminUrl)('places e2e with a DaData key (requires TEST_DATABASE_URL)', () => {
  let t: TestApp;
  let startupLogs: string[];
  let failNextWith: number | null = null;
  // Stubbed at the network boundary: the real DaData is never called.
  const upstream = vi.fn(async (url: string, _init: RequestInit) => {
    if (failNextWith !== null) {
      const status = failNextWith;
      failNextWith = null;
      return json({ message: `rejected ${KEY}` }, status);
    }
    return url.endsWith('/geolocate/address')
      ? json({ suggestions: [{ value: 'г Москва, Ленинградский пр-кт, д 36', data: {} }] })
      : json({
          suggestions: [
            {
              value: 'г Москва, Ленинградский пр-кт, д 36',
              data: { geo_lat: '55.7909', geo_lon: '37.5593', qc_geo: '0' },
            },
            {
              value: 'г Москва, Ленинградский пр-кт',
              data: { geo_lat: '55.79', geo_lon: '37.55', qc_geo: '2' },
            },
          ],
        });
  });

  beforeAll(async () => {
    vi.stubGlobal('fetch', upstream);
    ({ t, startupLogs } = await bootCapturingLogs({ DADATA_API_KEY: KEY }));
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await t?.close();
  });

  beforeEach(() => {
    t.resetRateLimits();
    upstream.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says on startup that address suggestions are on, without the key', () => {
    const text = startupLogs.join('\n');
    expect(text).toContain('Подсказки адресов DaData включены');
    expect(text).not.toContain(KEY);
  });

  it('proxies suggestions; the key goes only to DaData, never to the client', async () => {
    const user = await t.loginOnboarded();
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/places/suggest?q=${encodeURIComponent('Ленинградский 36')}`,
      headers: authHeader(user.token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: true,
      degraded: false,
      items: [
        { value: 'Ленинградский пр-кт, д 36', point: { lat: 55.7909, lng: 37.5593 } },
        { value: 'Ленинградский пр-кт', point: null },
      ],
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toContain(KEY);
    expect(JSON.stringify(response.headers)).not.toContain(KEY);

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(`${DADATA_BASE_URL}/suggest/address`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token ${KEY}`);
    // The user's identity never reaches DaData.
    expect(String(init.body)).not.toContain(user.user.id);
    expect(String(init.body)).not.toContain(String(user.user.telegramId));
  });

  it('reverse-geocodes the pin', async () => {
    const user = await t.loginOnboarded();
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/places/reverse?lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`,
      headers: authHeader(user.token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, degraded: false, address: 'Ленинградский пр-кт, д 36' });
  });

  it("one user's searches never warm another user's cache (no probing of exact places)", async () => {
    const a = await t.loginOnboarded();
    const b = await t.loginOnboarded();
    const suggest = (token: string, q: string) =>
      t.app.inject({
        method: 'GET',
        url: `/api/places/suggest?q=${encodeURIComponent(q)}`,
        headers: authHeader(token),
      });
    const reverse = (token: string) =>
      t.app.inject({
        method: 'GET',
        url: `/api/places/reverse?lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`,
        headers: authHeader(token),
      });

    expect((await suggest(a.token, 'Новая Башиловка 14')).statusCode).toBe(200);
    expect((await reverse(a.token)).statusCode).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    // The same user's retyping is still served from the cache.
    await suggest(a.token, 'новая  башиловка 14');
    await reverse(a.token);
    expect(upstream).toHaveBeenCalledTimes(2);

    await suggest(b.token, 'новая  башиловка 14');
    await reverse(b.token);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it('T-ABUSE-7 (places part): not onboarded → 403 before any upstream call', async () => {
    const user = await t.login();
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/places/suggest?q=${encodeURIComponent('Тверская 1')}`,
      headers: authHeader(user.token),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'not_onboarded' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('no token → 401 and no upstream call', async () => {
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/places/suggest?q=${encodeURIComponent('Тверская')}`,
    });
    expect(response.statusCode).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  // Keep last: the rejected key opens the breaker, so later upstream calls would degrade.
  it('answers 200 degraded when DaData rejects the key, and logs neither the key nor the query', async () => {
    const user = await t.loginOnboarded();
    const logs = (['log', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => {}),
    );
    failNextWith = 401;
    const response = await t.app.inject({
      method: 'GET',
      url: `/api/places/suggest?q=${encodeURIComponent('Беговая 5')}`,
      headers: authHeader(user.token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, degraded: true, items: [] });
    expect(response.body).not.toContain(KEY);
    expect(upstream).toHaveBeenCalledTimes(1);
    const logged = inspect(logs.map((spy) => spy.mock.calls));
    expect(logged).toContain('DaData отклонил ключ: проверьте DADATA_API_KEY');
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('Беговая');
  });
});
