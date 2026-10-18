import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { apiErrorDto } from '@masl/shared';
import { adminUrl, authHeader, bootApp, CANARY_POINT, type TestApp } from './helpers.js';

describe.skipIf(!adminUrl)('global error handling e2e (requires TEST_DATABASE_URL)', () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T-LOG-1: an unexpected DB error on a real route gets the 500 body and only the redacted log', async () => {
    const user = await t.loginOnboarded();
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    await t.db.execute(sql`alter table karma_events rename to karma_events_x`);
    try {
      const response = await t.app.inject({
        method: 'GET',
        url: `/api/me/karma-events?lat=${CANARY_POINT.lat}&lng=${CANARY_POINT.lng}`,
        headers: authHeader(user.token),
      });

      expect(response.statusCode).toBe(500);
      const body: unknown = response.json();
      expect(body).toEqual({ statusCode: 500, code: 'internal_error', message: 'Внутренняя ошибка сервера' });
      expect(apiErrorDto.safeParse(body).success).toBe(true);
    } finally {
      await t.db.execute(sql`alter table karma_events_x rename to karma_events`);
    }

    expect(log).toHaveBeenCalledTimes(1);
    const logged = inspect(log.mock.calls, { depth: 10 });
    expect(logged).toContain('GET /api/me/karma-events');
    expect(logged).toContain('DrizzleQueryError');
    expect(logged).toContain('pgCode=42P01');
    for (const secret of ['lat=', String(CANARY_POINT.lat), 'select', 'karma_events"', user.user.id]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('keeps a malformed JSON body a client error that is not logged', async () => {
    const user = await t.login();
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const response = await t.app.inject({
      method: 'PUT',
      url: '/api/me/onboarding',
      headers: { ...authHeader(user.token), 'content-type': 'application/json' },
      payload: '{bad',
    });

    expect(response.statusCode).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
});
