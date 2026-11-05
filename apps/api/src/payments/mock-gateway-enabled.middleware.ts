import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../common/app-error';
import { APP_ENV } from '../common/config';
import type { Env } from '../config/env';

/** B1: with the flag off every `/mock-gateway/*` answers 404 — before auth, so it cannot even be probed. */
@Injectable()
export class MockGatewayEnabledMiddleware implements NestMiddleware {
  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    if (this.env.MOCK_GATEWAY_ENABLED) return next();
    const { error } = AppError.notFound().getResponse() as { error: unknown };
    res.status(404).json({ error });
  }
}
