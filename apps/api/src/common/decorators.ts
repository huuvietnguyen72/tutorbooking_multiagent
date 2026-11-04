import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole, UserStatus } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const ALLOW_PASSWORD_CHANGE = 'allowPasswordChange';
export const SKIP_ORIGIN_CHECK = 'skipOriginCheck';
export const ALLOW_MULTIPART = 'allowMultipart';
export const RATE_LIMITS = 'rateLimits';

/** Route needs no login. Everything else is authenticated by default (deny by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route to roles. Role is read from the DB on every request, never from the JWT claim. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** Reachable while `mustChangePassword` is set (only /me, /me/password, /auth/logout). */
export const AllowPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE, true);

/** Webhooks authenticate by HMAC, not cookie, so they sit outside the Origin/CSRF check. */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

/** The only routes (avatar upload) allowed to carry multipart/form-data instead of JSON. */
export const AllowMultipart = () => SetMetadata(ALLOW_MULTIPART, true);

export interface RateLimitRule {
  name: string;
  limit: number;
  ttlMs: number;
  /** Bucket key; return `null` to skip the rule. */
  key: (req: import('express').Request & { user?: AuthUser }) => string | null;
}

/** Per-route limit on top of the global guest/user throttler (C2, C5, D1). Repeatable via array. */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
