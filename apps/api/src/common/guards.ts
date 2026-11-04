import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { SESSION_COOKIE, SessionService } from '../auth/session.service';
import type { Env } from '../config/env';
import { AppError } from './app-error';
import { APP_ENV } from './config';
import {
  ALLOW_MULTIPART,
  ALLOW_PASSWORD_CHANGE,
  AuthUser,
  IS_PUBLIC,
  RATE_LIMITS,
  RateLimitRule,
  ROLES,
  SKIP_ORIGIN_CHECK,
} from './decorators';
import { PrismaService } from './prisma.service';

type Req = Request & { user?: AuthUser };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF (C3): writes must carry a matching Origin (or Referer) and a JSON body. */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(
    @Inject(APP_ENV) env: Env,
    private readonly reflector: Reflector,
  ) {
    this.allowedOrigin = new URL(env.APP_BASE_URL).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Req>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if (this.originOf(req) !== this.allowedOrigin) throw AppError.forbidden();
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    const multipart = this.reflector.getAllAndOverride<boolean>(ALLOW_MULTIPART, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (hasBody && !req.is(multipart ? 'multipart/form-data' : 'application/json')) {
      throw AppError.validation([{ field: '(content-type)', code: 'must_be_json' }]);
    }
    return true;
  }

  private originOf(req: Req): string | null {
    const header = req.headers.origin ?? req.headers.referer;
    if (typeof header !== 'string') return null;
    try {
      return new URL(header).origin;
    } catch {
      return null;
    }
  }
}

/**
 * Authenticates from the `tb_session` cookie only. role/status/token_version/must_change_password
 * come from the DB on every request; JWT claims other than `sub`/`tv` are ignored (A6, C4).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Req>();
    const token = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
    const claims = typeof token === 'string' ? this.sessions.verify(token) : null;
    if (!claims) throw AppError.unauthenticated();

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.tokenVersion !== claims.tv) throw AppError.unauthenticated();
    if (user.status === 'LOCKED') throw new AppError(403, 'ACCOUNT_LOCKED', 'Account is locked');

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      mustChangePassword: user.mustChangePassword,
    };

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, targets)) {
      throw new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Password change required');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const user = context.switchToHttp().getRequest<Req>().user;
    if (!user) throw AppError.unauthenticated();
    if (!roles.includes(user.role)) throw AppError.forbidden();
    return true;
  }
}

/** Global limit (D1): 100/min per IP for guests, 300/min per user once logged in. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return (req as Req).user?.id ?? (req as Req).ip ?? 'unknown';
  }
}

/** Per-route rules from `@RateLimit(...)`, counted in the throttler's in-memory storage (C2, C5, D1). */
@Injectable()
export class RouteRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMITS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules) return true;
    const req = context.switchToHttp().getRequest<Req>();
    for (const rule of rules) {
      const key = rule.key(req);
      if (key === null) continue;
      const record = await this.storage.increment(`${rule.name}:${key}`, rule.ttlMs, rule.limit, rule.ttlMs, rule.name);
      if (record.isBlocked) throw new AppError(429, 'RATE_LIMITED', 'Too many requests');
    }
    return true;
  }
}
