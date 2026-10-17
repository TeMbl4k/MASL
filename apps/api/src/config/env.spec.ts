import { resolve } from 'node:path';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://masl:masl@localhost:5432/masl',
  BOT_TOKEN: '123456789:AAE-env-token_for-masl',
  JWT_SECRET: 'env-secret-'.repeat(4),
};

describe('loadEnv', () => {
  it('denies cross-origin access to the API without WEB_ORIGINS', () => {
    expect(loadEnv(base).WEB_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, WEB_ORIGINS: '' }).WEB_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).WEB_ORIGINS).toEqual([]);
  });

  it('normalizes WEB_ORIGINS to the Origin header form', () => {
    const env = loadEnv({ ...base, WEB_ORIGINS: 'HTTPS://Masl.Example/, https://xyz.trycloudflare.com' });
    expect(env.WEB_ORIGINS).toEqual(['https://masl.example', 'https://xyz.trycloudflare.com']);
  });

  it('rejects WEB_ORIGINS entries with a path or a non-http scheme', () => {
    expect(() => loadEnv({ ...base, WEB_ORIGINS: 'https://masl.example/app' })).toThrow(/WEB_ORIGINS/);
    expect(() => loadEnv({ ...base, WEB_ORIGINS: 'javascript:alert(1)' })).toThrow(/WEB_ORIGINS/);
  });

  it('refuses to start with placeholder secrets from .env.example', () => {
    expect(() => loadEnv({ ...base, BOT_TOKEN: '123456:replace-me' })).toThrow(/BOT_TOKEN/);
    expect(() =>
      loadEnv({ ...base, JWT_SECRET: 'replace-with-a-long-random-string-at-least-32-chars' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('WEB_DIST_DIR: an empty value sets no directory, a relative path becomes absolute', () => {
    expect(loadEnv({ ...base, WEB_DIST_DIR: '' }).WEB_DIST_DIR).toBeUndefined();
    expect(loadEnv({ ...base, WEB_DIST_DIR: 'web/build' }).WEB_DIST_DIR).toBe(resolve('web/build'));
  });
});
