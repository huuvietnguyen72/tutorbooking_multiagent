import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthModule } from '../auth/auth.module';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { Clock, SystemClock } from './clock';
import { envProvider } from './config';
import { AppThrottlerGuard, JwtAuthGuard, OriginGuard, RolesGuard, RouteRateLimitGuard } from './guards';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

const MINUTE = 60_000;
const hasUser = (ctx: import('@nestjs/common').ExecutionContext): boolean =>
  Boolean((ctx.switchToHttp().getRequest<Request & { user?: unknown }>()).user);

@Global()
@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'guest', ttl: MINUTE, limit: 100, skipIf: hasUser },
        { name: 'user', ttl: MINUTE, limit: 300, skipIf: (ctx) => !hasUser(ctx) },
      ],
    }),
  ],
  providers: [
    envProvider,
    PrismaService,
    StorageService,
    { provide: Clock, useClass: SystemClock },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Guard order matters: Origin (CSRF) → Jwt (auth, sets req.user) → Roles → global throttle → per-route limits.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: RouteRateLimitGuard },
  ],
  exports: [envProvider, PrismaService, StorageService, Clock],
})
export class CommonModule {}
