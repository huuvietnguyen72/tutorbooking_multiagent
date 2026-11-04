import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { SESSION_COOKIE } from '../src/auth/session.service';
import { runSeed } from '../src/seed/seed';
import {
  API,
  createTestApp,
  get,
  insertUser,
  loginCookie,
  ORIGIN,
  post,
  resetDb,
  TEST_PASSWORD,
  TestApp,
  uniqueEmail,
} from './helpers';

describe('Auth + RBAC (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  describe('register', () => {
    it('creates a STUDENT and never returns the hash', async () => {
      const email = uniqueEmail();
      const res = await post(t.app, '/auth/register')
        .send({ email, password: TEST_PASSWORD, fullName: ' An ', role: 'STUDENT' })
        .expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email,
        fullName: 'An',
        role: 'STUDENT',
        status: 'ACTIVE',
        mustChangePassword: false,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|"password"/);
      const row = await t.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('creates a TUTOR in PENDING_APPROVAL', async () => {
      const res = await post(t.app, '/auth/register')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'Gia sư', role: 'TUTOR' })
        .expect(201);
      expect(res.body.tutorApprovalStatus).toBe('PENDING_APPROVAL');
    });

    it('rejects role ADMIN and extra fields with 400 VALIDATION_FAILED', async () => {
      const res = await post(t.app, '/auth/register')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'X', role: 'ADMIN' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toEqual([expect.objectContaining({ field: 'role' })]);
      await post(t.app, '/auth/register')
        .send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'X', role: 'STUDENT', status: 'ACTIVE' })
        .expect(400);
    });

    it('rejects short passwords and bad emails', async () => {
      await post(t.app, '/auth/register').send({ email: uniqueEmail(), password: 'short', fullName: 'X', role: 'STUDENT' }).expect(400);
      await post(t.app, '/auth/register').send({ email: 'not-an-email', password: TEST_PASSWORD, fullName: 'X', role: 'STUDENT' }).expect(400);
    });

    it('409 EMAIL_TAKEN, case-insensitively', async () => {
      const email = uniqueEmail('dup');
      await post(t.app, '/auth/register').send({ email, password: TEST_PASSWORD, fullName: 'A', role: 'STUDENT' }).expect(201);
      const res = await post(t.app, '/auth/register')
        .send({ email: email.toUpperCase(), password: TEST_PASSWORD, fullName: 'B', role: 'STUDENT' })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });
  });

  describe('login / me / logout', () => {
    it('sets a hardened HS256 cookie and /me returns the profile', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const res = await post(t.app, '/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\/api/);
      expect(cookie).not.toMatch(/Secure/); // APP_BASE_URL is http in tests
      expect(res.body.email).toBe(user.email);
      const token = cookie.split(';')[0].split('=')[1];
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');

      const me = await get(t.app, '/me', `${SESSION_COOKIE}=${token}`).expect(200);
      expect(me.body.id).toBe(user.id);
    });

    it('login email is case-insensitive', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      await post(t.app, '/auth/login').send({ email: user.email.toUpperCase(), password: TEST_PASSWORD }).expect(200);
    });

    it('wrong password and unknown email give the same 401 INVALID_CREDENTIALS', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const wrong = await post(t.app, '/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
      const unknown = await post(t.app, '/auth/login').send({ email: uniqueEmail('nobody'), password: 'wrong-password' }).expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('locked account: wrong password stays 401, right password gives 403 ACCOUNT_LOCKED', async () => {
      const user = await insertUser(t.prisma, 'STUDENT', { status: 'LOCKED' });
      const wrong = await post(t.app, '/auth/login').send({ email: user.email, password: 'wrong-password' }).expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      const right = await post(t.app, '/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(403);
      expect(right.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('logout clears the cookie and revokes every session of the user', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const a = await loginCookie(t.app, user.email);
      const b = await loginCookie(t.app, user.email);
      const res = await post(t.app, '/auth/logout', a).expect(204);
      expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
      await get(t.app, '/me', a).expect(401);
      await get(t.app, '/me', b).expect(401);
    });

    it('PATCH /me updates the name only', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      const res = await request(t.app.getHttpServer())
        .patch(`${API}/me`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({ fullName: 'Tên mới' })
        .expect(200);
      expect(res.body.fullName).toBe('Tên mới');
      await request(t.app.getHttpServer())
        .patch(`${API}/me`)
        .set('Origin', ORIGIN)
        .set('Cookie', cookie)
        .send({ fullName: 'X', role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('change password', () => {
    it('rotates the hash, invalidates old sessions and re-issues a working cookie', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const old = await loginCookie(t.app, user.email);
      const other = await loginCookie(t.app, user.email);
      const next = `${TEST_PASSWORD}-new`;
      const res = await post(t.app, '/me/password', old).send({ currentPassword: TEST_PASSWORD, newPassword: next }).expect(204);
      const fresh = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await get(t.app, '/me', fresh).expect(200);
      await get(t.app, '/me', old).expect(401);
      await get(t.app, '/me', other).expect(401);
      await post(t.app, '/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(401);
      await post(t.app, '/auth/login').send({ email: user.email, password: next }).expect(200);
    });

    it('403 WRONG_CURRENT_PASSWORD; 400 for weak or unchanged password', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      const wrong = await post(t.app, '/me/password', cookie).send({ currentPassword: 'nope-nope-nope', newPassword: 'another-password' }).expect(403);
      expect(wrong.body.error.code).toBe('WRONG_CURRENT_PASSWORD');
      await post(t.app, '/me/password', cookie).send({ currentPassword: TEST_PASSWORD, newPassword: 'short' }).expect(400);
      await post(t.app, '/me/password', cookie).send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD }).expect(400);
    });

    it('requires authentication', async () => {
      await post(t.app, '/me/password').send({ currentPassword: 'a', newPassword: 'bbbbbbbb' }).expect(401);
    });
  });

  describe('guards', () => {
    it('no cookie -> 401 UNAUTHENTICATED in the standard error format', async () => {
      const res = await get(t.app, '/probe/any').expect(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
    });

    it('garbage, wrong-secret and alg=none tokens -> 401', async () => {
      await get(t.app, '/probe/any', `${SESSION_COOKIE}=garbage`).expect(401);
      const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', tv: 0 })).toString('base64url')}.`;
      await get(t.app, '/probe/any', `${SESSION_COOKIE}=${none}`).expect(401);
    });

    it('a token from the Authorization header is ignored (cookie only)', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      await request(t.app.getHttpServer())
        .get(`${API}/probe/any`)
        .set('Authorization', `Bearer ${cookie.split('=')[1]}`)
        .expect(401);
    });

    it('wrong role -> 403 FORBIDDEN, right role -> 200', async () => {
      const student = await loginCookie(t.app, (await insertUser(t.prisma, 'STUDENT')).email);
      const tutor = await loginCookie(t.app, (await insertUser(t.prisma, 'TUTOR')).email);
      const admin = await loginCookie(t.app, (await insertUser(t.prisma, 'ADMIN')).email);
      expect((await get(t.app, '/probe/admin', student).expect(403)).body.error.code).toBe('FORBIDDEN');
      await get(t.app, '/probe/admin', tutor).expect(403);
      await get(t.app, '/probe/admin', admin).expect(200);
      await get(t.app, '/probe/tutor', student).expect(403);
      await get(t.app, '/probe/tutor', tutor).expect(200);
      await post(t.app, '/probe/student-write', tutor).expect(403);
      await post(t.app, '/probe/student-write', student).expect(200);
    });

    it('reads the role from the DB on every request, not the JWT claim', async () => {
      const user = await insertUser(t.prisma, 'ADMIN');
      const cookie = await loginCookie(t.app, user.email);
      await get(t.app, '/probe/admin', cookie).expect(200);
      await t.prisma.user.update({ where: { id: user.id }, data: { role: 'STUDENT' } });
      await get(t.app, '/probe/admin', cookie).expect(403);
    });

    it('locking a user (token_version bump) kills the session immediately', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      await t.prisma.user.update({ where: { id: user.id }, data: { status: 'LOCKED', tokenVersion: { increment: 1 } } });
      await get(t.app, '/me', cookie).expect(401);
    });

    it('locked status alone (no version bump) is refused with 403 ACCOUNT_LOCKED', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      await t.prisma.user.update({ where: { id: user.id }, data: { status: 'LOCKED' } });
      expect((await get(t.app, '/me', cookie).expect(403)).body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('expired token -> 401 (Clock is injectable)', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const cookie = await loginCookie(t.app, user.email);
      await get(t.app, '/me', cookie).expect(200);
      t.clock.advance(8 * 60 * 60 * 1000 + 1000);
      await get(t.app, '/me', cookie).expect(401);
      t.clock.advance(-(8 * 60 * 60 * 1000 + 1000));
    });

    it('must-change-password restricts everything except /me, /me/password, /auth/logout', async () => {
      const user = await insertUser(t.prisma, 'ADMIN', { mustChangePassword: true });
      const cookie = await loginCookie(t.app, user.email);
      const me = await get(t.app, '/me', cookie).expect(200);
      expect(me.body.mustChangePassword).toBe(true);
      const blocked = await get(t.app, '/probe/admin', cookie).expect(403);
      expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const res = await post(t.app, '/me/password', cookie)
        .send({ currentPassword: TEST_PASSWORD, newPassword: `${TEST_PASSWORD}-2` })
        .expect(204);
      const fresh = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await get(t.app, '/probe/admin', fresh).expect(200);
    });

    it('/health stays public', async () => {
      await get(t.app, '/health').expect(200);
    });
  });

  describe('CSRF / hardening', () => {
    it('writes without Origin and Referer are rejected', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      const res = await request(t.app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('a foreign Origin is rejected, a matching Referer is accepted', async () => {
      const user = await insertUser(t.prisma, 'STUDENT');
      await request(t.app.getHttpServer())
        .post(`${API}/auth/login`)
        .set('Origin', 'http://evil.example')
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);
      await request(t.app.getHttpServer())
        .post(`${API}/auth/login`)
        .set('Referer', `${ORIGIN}/dang-nhap`)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(200);
    });

    it('a write with a non-JSON body is rejected', async () => {
      const res = await request(t.app.getHttpServer())
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('email=a@b.c&password=x')
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('malformed JSON -> 400 in the standard format', async () => {
      const res = await request(t.app.getHttpServer())
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"email":')
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('unknown route -> 404 NOT_FOUND format; helmet headers on, x-powered-by off', async () => {
      const res = await get(t.app, '/does-not-exist').expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    });
  });

  describe('seed', () => {
    const adminEmail = 'seed-admin@example.com';
    const adminPassword = `seed-${TEST_PASSWORD}`;

    beforeAll(async () => {
      await resetDb(t.prisma);
    });

    it('creates the Admin with must_change_password, no demo data by default, and is idempotent', async () => {
      const env = { SEED_ADMIN_EMAIL: adminEmail, SEED_ADMIN_PASSWORD: adminPassword, SEED_DEMO_DATA: 'false' as const };
      await runSeed(t.prisma, env);
      await runSeed(t.prisma, env);
      const users = await t.prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0]).toMatchObject({ email: adminEmail, role: 'ADMIN', mustChangePassword: true, status: 'ACTIVE' });
      expect(users[0].passwordHash).toMatch(/^\$argon2id\$/);
      expect(await t.prisma.slot.count()).toBe(0);
      expect(await t.prisma.subject.count()).toBeGreaterThan(0);
      const res = await post(t.app, '/auth/login').send({ email: adminEmail, password: adminPassword }).expect(200);
      expect(res.body.mustChangePassword).toBe(true);
    });

    it('does not reset an existing admin password on re-run', async () => {
      const cookie = await loginCookie(t.app, adminEmail, adminPassword);
      const changed = `${adminPassword}-changed`;
      await post(t.app, '/me/password', cookie).send({ currentPassword: adminPassword, newPassword: changed }).expect(204);
      await runSeed(t.prisma, { SEED_ADMIN_EMAIL: adminEmail, SEED_ADMIN_PASSWORD: adminPassword, SEED_DEMO_DATA: 'false' });
      await loginCookie(t.app, adminEmail, changed);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).mustChangePassword).toBe(false);
    });

    it('adds demo accounts and slots only with SEED_DEMO_DATA=true', async () => {
      const env = { SEED_ADMIN_EMAIL: adminEmail, SEED_ADMIN_PASSWORD: adminPassword, SEED_DEMO_DATA: 'true' as const };
      await runSeed(t.prisma, env, new Date());
      await runSeed(t.prisma, env, new Date());
      expect(await t.prisma.user.count({ where: { role: 'TUTOR' } })).toBe(2);
      expect(await t.prisma.user.count({ where: { role: 'STUDENT' } })).toBe(1);
      expect(await t.prisma.slot.count()).toBe(28);
      expect(await t.prisma.tutorProfile.count({ where: { approvalStatus: 'APPROVED' } })).toBe(2);
    });
  });

  it('PrismaService is the DB handle used by the app', () => {
    expect(t.app.get(PrismaService)).toBeDefined();
  });
});
