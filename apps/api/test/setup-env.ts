import { randomBytes } from 'node:crypto';

// Test-only values generated per run, so no secret literals live in the repo (gitleaks).
const rand = (bytes = 32): string => randomBytes(bytes).toString('hex');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= rand();
process.env.PAYMENT_WEBHOOK_SECRET ??= rand();
process.env.SEED_ADMIN_PASSWORD ??= rand(12);
process.env.SEED_DEMO_DATA ??= 'false';
process.env.APP_BASE_URL ??= 'http://localhost:8080';
process.env.EXPIRY_JOB_INTERVAL_SECONDS ??= '0'; // tests drive the expiry job by hand
