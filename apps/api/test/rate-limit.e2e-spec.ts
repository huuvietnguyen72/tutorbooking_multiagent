import { ThrottlerStorage } from '@nestjs/throttler';
import { createTestApp, get, insertUser, loginCookie, post, resetDb, TEST_PASSWORD, TestApp, uniqueEmail } from './helpers';

const IP = '203.0.113.7';

describe('Rate limiting (e2e)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp(); // fresh in-memory counters per test
    await resetDb(t.prisma);
  });

  afterEach(async () => {
    await t.close();
  });

  it('login: 5/min per IP+email, then 429 RATE_LIMITED', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 5; i++) {
      await post(t.app, '/auth/login', undefined, IP).send({ email, password: 'wrong-password' }).expect(401);
    }
    const res = await post(t.app, '/auth/login', undefined, IP).send({ email, password: 'wrong-password' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // another email from the same IP has its own per-minute bucket
    await post(t.app, '/auth/login', undefined, IP).send({ email: uniqueEmail(), password: 'wrong-password' }).expect(401);
  });

  it('login: 10/hour per email regardless of IP bucket', async () => {
    const email = uniqueEmail();
    // 2 buckets of 5 would be needed within the minute; spread the minute window with the clock-less key trick:
    // the per-minute bucket blocks at 5, so verify the hourly rule independently via storage.
    const storage = t.app.get(ThrottlerStorage);
    for (let i = 0; i < 10; i++) await storage.increment(`login-email:email:${email}`, 3_600_000, 10, 3_600_000, 'login-email');
    const res = await post(t.app, '/auth/login', undefined, IP).send({ email, password: 'wrong-password' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('register: 3/min per IP', async () => {
    for (let i = 0; i < 3; i++) {
      await post(t.app, '/auth/register', undefined, IP).send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'A', role: 'STUDENT' }).expect(201);
    }
    await post(t.app, '/auth/register', undefined, IP).send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'A', role: 'STUDENT' }).expect(429);
  });

  it('change password: 5/min per user', async () => {
    const user = await insertUser(t.prisma, 'STUDENT');
    const cookie = await loginCookie(t.app, user.email);
    for (let i = 0; i < 5; i++) {
      await post(t.app, '/me/password', cookie).send({ currentPassword: 'nope-nope-nope', newPassword: 'another-password' }).expect(403);
    }
    await post(t.app, '/me/password', cookie).send({ currentPassword: 'nope-nope-nope', newPassword: 'another-password' }).expect(429);
  });

  it('global: guests 100/min per IP', async () => {
    for (let i = 0; i < 100; i++) await get(t.app, '/health', undefined, IP).expect(200);
    await get(t.app, '/health', undefined, IP).expect(429);
  });

  it('global: logged-in users get 300/min and are counted per user, not per IP', async () => {
    const user = await insertUser(t.prisma, 'STUDENT');
    const cookie = await loginCookie(t.app, user.email);
    for (let i = 0; i < 150; i++) await get(t.app, '/probe/any', cookie).expect(200);
    // the guest bucket for this IP is untouched by authenticated traffic
    await get(t.app, '/health', undefined, IP).expect(200);
  });
});
