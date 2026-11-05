import { join } from 'node:path';

export type Role = 'student' | 'student2' | 'tutor' | 'tutor2' | 'admin';

export const AUTH_DIR = join(__dirname, '..', '.auth');
export const stateFile = (role: Role): string => join(AUTH_DIR, `${role}.json`);
export const STUDENT2_FILE = join(AUTH_DIR, 'student2-meta.json');
