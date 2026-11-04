import { Env, validateEnv } from '../config/env';

/** Injection token for the validated environment. Validation runs once, at module init (D5). */
export const APP_ENV = Symbol('APP_ENV');

export const envProvider = {
  provide: APP_ENV,
  useFactory: (): Env => validateEnv(process.env),
};
