import { randomBytes, randomInt } from 'node:crypto';
import { Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Roles } from '../src/common/decorators';
import { Clock, FixedClock } from '../src/common/clock';
import { PasswordService } from '../src/auth/password.service';

export const ORIGIN = process.env.APP_BASE_URL ?? 'http://localhost:8080';
export const API = '/api/v1';
export const TEST_PASSWORD = `pw-${randomBytes(12).toString('hex')}`;

/** Probe routes that exist only in tests: they exercise the guards without waiting for later tickets. */
@Controller('probe')
export class ProbeController {
  @Get('any')
  any(): { ok: true } {
    return { ok: true };
  }

  @Roles('ADMIN')
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }

  @Roles('TUTOR')
  @Get('tutor')
  tutor(): { ok: true } {
    return { ok: true };
  }

  @Roles('STUDENT')
  @HttpCode(200)
  @Post('student-write')
  studentWrite(): { ok: true } {
    return { ok: true };
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaClient;
  clock: FixedClock;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const clock = new FixedClock(new Date());
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProbeController],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = new PrismaClient();
  return {
    app,
    prisma,
    clock,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE audit_logs, booking_history, payment_events, reviews, payments, bookings, slots,
     tutor_subjects, subjects, tutor_profiles, email_outbox, users RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
export const uniqueEmail = (prefix = 'user'): string => `${prefix}${Date.now()}${counter++}@example.com`;

/** Insert a user directly (bypasses the API) and return it. */
export async function insertUser(
  prisma: PrismaClient,
  role: 'STUDENT' | 'TUTOR' | 'ADMIN',
  overrides: Partial<{ email: string; status: 'ACTIVE' | 'LOCKED'; mustChangePassword: boolean }> = {},
) {
  const passwordHash = await new PasswordService().hash(TEST_PASSWORD);
  return prisma.user.create({
    data: {
      email: overrides.email ?? uniqueEmail(role.toLowerCase()),
      passwordHash,
      fullName: `Test ${role}`,
      role,
      status: overrides.status ?? 'ACTIVE',
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
}

/** Each request comes from a distinct client IP (trust proxy = 1 hop) so per-IP limits do not leak between tests. */
export const randomIp = (): string => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** Same-origin write helper: adds the Origin header the CSRF guard requires. */
export const post = (app: INestApplication, path: string, cookie?: string, ip = randomIp()) => {
  const req = request(app.getHttpServer()).post(`${API}${path}`).set('Origin', ORIGIN).set('X-Forwarded-For', ip);
  return cookie ? req.set('Cookie', cookie) : req;
};

export const get = (app: INestApplication, path: string, cookie?: string, ip = randomIp()) => {
  const req = request(app.getHttpServer()).get(`${API}${path}`).set('X-Forwarded-For', ip);
  return cookie ? req.set('Cookie', cookie) : req;
};

export async function loginCookie(app: INestApplication, email: string, password = TEST_PASSWORD): Promise<string> {
  const res = await post(app, '/auth/login').send({ email, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[];
  return raw[0].split(';')[0];
}
