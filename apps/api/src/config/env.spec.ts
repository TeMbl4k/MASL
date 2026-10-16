import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://masl:masl@localhost:5432/masl',
  BOT_TOKEN: '123456789:AAE-env-token_for-masl',
  JWT_SECRET: 'env-secret-'.repeat(4),
};

describe('loadEnv', () => {
  it('без WEB_ORIGINS чужие домены к API не допускаются', () => {
    expect(loadEnv(base).WEB_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, WEB_ORIGINS: '' }).WEB_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).WEB_ORIGINS).toEqual([]);
  });

  it('приводит WEB_ORIGINS к виду заголовка Origin', () => {
    const env = loadEnv({ ...base, WEB_ORIGINS: 'HTTPS://Masl.Example/, https://xyz.trycloudflare.com' });
    expect(env.WEB_ORIGINS).toEqual(['https://masl.example', 'https://xyz.trycloudflare.com']);
  });

  it('отклоняет в WEB_ORIGINS адреса с путём и не-http схемы', () => {
    expect(() => loadEnv({ ...base, WEB_ORIGINS: 'https://masl.example/app' })).toThrow(/WEB_ORIGINS/);
    expect(() => loadEnv({ ...base, WEB_ORIGINS: 'javascript:alert(1)' })).toThrow(/WEB_ORIGINS/);
  });

  it('не стартует с заглушками секретов из .env.example', () => {
    expect(() => loadEnv({ ...base, BOT_TOKEN: '123456:replace-me' })).toThrow(/BOT_TOKEN/);
    expect(() =>
      loadEnv({ ...base, JWT_SECRET: 'replace-with-a-long-random-string-at-least-32-chars' }),
    ).toThrow(/JWT_SECRET/);
  });
});
