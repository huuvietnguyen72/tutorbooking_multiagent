import { z } from 'zod';

const PLACEHOLDER = /^(change[-_ ]?me|placeholder|example|changeme|secret|password)$/i;

const secret = (name: string, min = 32) =>
  z
    .string({ error: `${name} is required` })
    .min(min, `${name} must be at least ${min} characters`)
    .refine((value) => !PLACEHOLDER.test(value), `${name} must not be a placeholder value`);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgresql:// URL'),
    JWT_SECRET: secret('JWT_SECRET'),
    PAYMENT_WEBHOOK_SECRET: secret('PAYMENT_WEBHOOK_SECRET'),
    SEED_ADMIN_PASSWORD: z
      .string({ error: 'SEED_ADMIN_PASSWORD is required' })
      .min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters'),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@tutor.local'),
    SEED_DEMO_DATA: z.enum(['true', 'false']).default('false'),
    APP_BASE_URL: z.string().url().default('http://localhost:8080'),
    SLOT_DURATION_MINUTES: z.coerce.number().int().min(15).max(240).default(60),
    MIN_BOOKING_LEAD_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
    DISPLAY_TIMEZONE: z.string().min(1).default('Asia/Ho_Chi_Minh'),
    UPLOAD_DIR: z.string().min(1).default('./uploads'),
    BOOKING_HOLD_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    CANCELLATION_WINDOW_HOURS: z.coerce.number().int().min(0).max(168).default(24),
    /** 0 disables the in-process timer (tests call the job directly). */
    EXPIRY_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
    PAYMENT_PROVIDER: z.enum(['mock', 'vnpay']).default('mock'),
    /** Off by default in production (B1); compose demo opts in through .env. */
    MOCK_GATEWAY_ENABLED: z.enum(['true', 'false']).optional(),
    /** Where the mock gateway POSTs its signed webhook; never derived from the request Host (B5). */
    INTERNAL_WEBHOOK_BASE_URL: z.string().url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message: 'PAYMENT_WEBHOOK_SECRET must differ from JWT_SECRET',
      });
    }
  })
  .transform((env) => ({
    ...env,
    MOCK_GATEWAY_ENABLED: (env.MOCK_GATEWAY_ENABLED ?? (env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    INTERNAL_WEBHOOK_BASE_URL: (env.INTERNAL_WEBHOOK_BASE_URL ?? `http://127.0.0.1:${env.PORT}`).replace(/\/+$/, ''),
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
