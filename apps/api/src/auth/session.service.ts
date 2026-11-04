import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import type { Env } from '../config/env';

export const SESSION_COOKIE = 'tb_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionClaims {
  sub: string;
  role: string;
  tv: number;
}

@Injectable()
export class SessionService {
  private readonly secure: boolean;

  constructor(
    @Inject(APP_ENV) private readonly env: Env,
    private readonly clock: Clock,
  ) {
    this.secure = new URL(env.APP_BASE_URL).protocol === 'https:';
  }

  sign(user: { id: string; role: string; tokenVersion: number }): string {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const claims: SessionClaims & { iat: number; exp: number } = {
      sub: user.id,
      role: user.role,
      tv: user.tokenVersion,
      iat,
      exp: iat + SESSION_TTL_SECONDS,
    };
    return jwt.sign(claims, this.env.JWT_SECRET, { algorithm: 'HS256' });
  }

  /** Returns claims or `null`. Algorithm is pinned to HS256 (C4); `role` is informational only. */
  verify(token: string): SessionClaims | null {
    try {
      const payload = jwt.verify(token, this.env.JWT_SECRET, {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1000),
      });
      if (typeof payload === 'string') return null;
      if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
      return { sub: payload.sub, role: String(payload.role), tv: payload.tv };
    } catch {
      return null;
    }
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, sameSite: 'lax', secure: this.secure, path: '/api' };
  }

  setCookie(res: Response, token: string): void {
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
  }

  clearCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }
}
