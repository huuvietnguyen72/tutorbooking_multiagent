import { validateEnv } from './env';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  PAYMENT_WEBHOOK_SECRET: 'b'.repeat(32),
  SEED_ADMIN_PASSWORD: 'admin-password-123',
  SEED_DEMO_DATA: 'false',
  APP_BASE_URL: 'http://localhost:8080',
};

describe('validateEnv', () => {
  it('accepts a valid configuration', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('test');
    expect(env.SEED_DEMO_DATA).toBe('false');
  });

  it('rejects a missing JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects identical JWT and webhook secrets', () => {
    expect(() =>
      validateEnv({ ...base, PAYMENT_WEBHOOK_SECRET: base.JWT_SECRET }),
    ).toThrow(/must differ/);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('rejects placeholder secrets', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'changeme' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a short SEED_ADMIN_PASSWORD', () => {
    expect(() => validateEnv({ ...base, SEED_ADMIN_PASSWORD: 'short' })).toThrow(
      /at least 12/,
    );
  });
});
