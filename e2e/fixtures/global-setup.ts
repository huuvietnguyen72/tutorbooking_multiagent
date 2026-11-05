import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Api } from './api';
import { Db } from './db';
import { ACCOUNTS, ADMIN_EMAIL, demoPassword } from './env';
import { AUTH_DIR, STUDENT2_FILE, stateFile, type Role } from './paths';

/** Log in once per role (login is rate limited to 5/min per account) and keep the cookies as storageState. */
export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  const password = demoPassword();

  const roles: [Role, string][] = [
    ['student', ACCOUNTS.student.email],
    ['tutor', ACCOUNTS.tutor.email],
    ['tutor2', ACCOUNTS.tutor2.email],
    ['admin', ADMIN_EMAIL],
  ];
  const db = new Db();
  await db.clearMustChangePassword(ADMIN_EMAIL);
  await db.close();
  for (const [role, email] of roles) {
    const api = await Api.anonymous();
    await api.login(email, password);
    await api.ctx.storageState({ path: stateFile(role) });
    await api.dispose();
  }

  // A second student, fresh per run, to prove a released slot is bookable by someone else.
  const email = `e2e-student2-${randomUUID().slice(0, 8)}@e2e.local`;
  const student2Password = `E2e-${randomUUID()}`;
  const api = await Api.anonymous();
  await api.post('/auth/register', { email, password: student2Password, fullName: 'Học Viên Hai', role: 'STUDENT' });
  await api.login(email, student2Password); // register does not start a session
  await api.ctx.storageState({ path: stateFile('student2') });
  writeFileSync(STUDENT2_FILE, JSON.stringify({ email }));
  await api.dispose();
}
