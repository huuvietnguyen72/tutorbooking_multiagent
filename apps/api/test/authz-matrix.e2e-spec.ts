import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { fixtures, UUID0, User } from './fixtures';
import { API, createTestApp, loginCookie, ORIGIN, randomIp, resetDb, TestApp } from './helpers';

type Role = 'STUDENT' | 'TUTOR' | 'ADMIN';
interface Op {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  roles: string[];
}

/** Reads `x-roles` per operation straight from docs/openapi.yaml so the matrix cannot drift from the spec. */
function loadOps(): Op[] {
  const lines = readFileSync(join(__dirname, '../../../docs/openapi.yaml'), 'utf8').split('\n');
  const ops: Op[] = [];
  let path = '';
  let method = '';
  let inPaths = false;
  for (const line of lines) {
    if (/^paths:/.test(line)) inPaths = true;
    else if (/^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      method = '';
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) {
      method = m[1];
      continue;
    }
    const r = /^ {6}x-roles:\s*\[(.*)\]\s*$/.exec(line);
    if (r && path && method) {
      ops.push({ method: method as Op['method'], path, roles: r[1].split(',').map((s) => s.trim()) });
    }
  }
  return ops;
}

const concrete = (path: string): string =>
  path.replace(/\{action\}/, 'approve').replace(/\{[^}]+\}/g, UUID0);

describe('authorization matrix from docs/openapi.yaml (TC-AUTH-09)', () => {
  let t: TestApp;
  const users = {} as Record<Role, User>;
  // Public routes and the provider-signed webhook have their own auth; the guarded ones are the matrix.
  const guarded = loadOps().filter((o) => !o.roles.includes('PUBLIC'));

  const call = (op: Op, cookie?: string) => {
    const req = request(t.app.getHttpServer())[op.method](`${API}${concrete(op.path)}`).set('Origin', ORIGIN).set('X-Forwarded-For', randomIp());
    const authed = cookie ? req.set('Cookie', cookie) : req;
    if (op.method === 'get' || op.method === 'delete') return authed;
    // OriginGuard runs before auth and demands multipart for upload routes, so send a multipart body there.
    return op.path.endsWith('/avatar') ? authed.field('probe', '1') : authed.send({});
  };

  beforeAll(async () => {
    t = await createTestApp();
    const f = fixtures(t);
    await resetDb(t.prisma);
    users.STUDENT = await f.addUser('STUDENT');
    users.TUTOR = await f.addTutor();
    users.ADMIN = await f.addUser('ADMIN');
  });
  afterAll(() => t.close());

  it('parses a plausible number of guarded operations', () => {
    expect(guarded.length).toBeGreaterThanOrEqual(30);
  });

  // login-email is limited to 10/hour per address, so log in once per role and reuse the session.
  const sessions: Partial<Record<Role, string>> = {};
  const cookieFor = async (op: Op, role: Role): Promise<string> => {
    if (op.path === '/auth/logout') {
      // Logout destroys the session; use a throwaway user so the shared cookie stays valid.
      const f = fixtures(t);
      const user = role === 'TUTOR' ? await f.addTutor() : await f.addUser(role);
      return loginCookie(t.app, user.email);
    }
    return (sessions[role] ??= await loginCookie(t.app, users[role].email));
  };

  it.each(guarded.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o] as const))('%s: anonymous 401, disallowed roles 403, allowed roles never 401/403', async (_name, op) => {
    expect((await call(op)).status).toBe(401);
    for (const role of ['STUDENT', 'TUTOR', 'ADMIN'] as Role[]) {
      const status = (await call(op, await cookieFor(op, role))).status;
      if (op.roles.includes(role)) expect([401, 403]).not.toContain(status);
      else expect(status).toBe(403);
    }
  });
});
