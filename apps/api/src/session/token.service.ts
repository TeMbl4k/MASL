import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { ENV, type Env } from '../config/env.js';

const ISSUER = 'masl-api';
const AUDIENCE = 'masl-web';

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/** Short-lived session JWTs (HS256) the Mini App gets after initData verification. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async issue(userId: string, now: Date = new Date()): Promise<IssuedToken> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAt + this.env.SESSION_TTL_SECONDS;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAtSeconds)
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  /** Returns the user id, or null if the token is invalid. */
  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
