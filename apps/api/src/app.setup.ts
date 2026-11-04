import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Shared by main.ts and the e2e tests so tests exercise the real HTTP hardening. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1); // exactly one hop: nginx overwrites X-Forwarded-For (C2)
  express.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } } }));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
}
