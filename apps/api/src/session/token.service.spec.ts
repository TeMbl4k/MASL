import { SignJWT } from 'jose';
import type { Env } from '../config/env.js';
import { TokenService } from './token.service.js';

const env = { JWT_SECRET: 'x'.repeat(40), SESSION_TTL_SECONDS: 3600 } as Env;
const service = new TokenService(env);
const USER_ID = '6f1c2f4e-2b7a-4c55-9a1e-0a4b2a9b8c11';

describe('TokenService', () => {
  it('issues a token and resolves the user from it', async () => {
    const { token, expiresAt } = await service.issue(USER_ID);
    expect(await service.verify(token)).toBe(USER_ID);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an expired token', async () => {
    const { token } = await service.issue(USER_ID, new Date(Date.now() - 2 * 3600_000));
    expect(await service.verify(token)).toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const other = new TokenService({ ...env, JWT_SECRET: 'y'.repeat(40) });
    const { token } = await other.issue(USER_ID);
    expect(await service.verify(token)).toBeNull();
  });

  it('rejects a token without our issuer/audience', async () => {
    const key = new TextEncoder().encode(env.JWT_SECRET);
    const foreign = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setExpirationTime('1h')
      .sign(key);
    expect(await service.verify(foreign)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await service.verify('abc.def.ghi')).toBeNull();
  });
});
