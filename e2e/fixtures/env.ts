function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the E2E suite (see docs/test-plan.md section 6)`);
  return value;
}

export const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:8080';
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Seed demo accounts share the SEED_ADMIN_PASSWORD value. */
export const demoPassword = (): string => process.env.E2E_DEMO_PASSWORD ?? required('SEED_ADMIN_PASSWORD');

export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@tutor.local';

export const ACCOUNTS = {
  student: { email: 'hoc-vien@demo.local', fullName: 'Lê Học Viên' },
  tutor: { email: 'gia-su-toan@demo.local', fullName: 'Nguyễn Văn An', priceVnd: 200_000 },
  tutor2: { email: 'gia-su-anh@demo.local', fullName: 'Trần Thị Bình', priceVnd: 250_000 },
} as const;

export const databaseUrl = (): string =>
  process.env.E2E_DATABASE_URL ??
  `postgresql://${process.env.POSTGRES_USER ?? 'tutor'}:${encodeURIComponent(required('POSTGRES_PASSWORD'))}@127.0.0.1:5432/${process.env.E2E_POSTGRES_DB ?? 'tutor_booking_test'}`;
