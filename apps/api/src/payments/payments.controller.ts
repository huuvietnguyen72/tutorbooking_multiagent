import { Body, Controller, Get, Header, Headers, HttpCode, Logger, Param, PayloadTooLargeException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, Public, RateLimit, Roles, SkipOriginCheck } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import { z } from 'zod';
import { MockGatewayService, GatewayPaymentDto } from './mock-gateway.service';
import { MAX_WEBHOOK_BYTES, SIGNATURE_HEADER } from './mock-signature';
import { InvalidSignatureError, PAYMENT_PROVIDER, PaymentProvider } from './payment-provider';
import { PaymentsService } from './payments.service';

const MINUTE = 60_000;
const NO_STORE = 'no-store';
const NO_REFERRER = 'no-referrer';

const completeSchema = z.object({ result: z.enum(['SUCCESS', 'FAILURE']) }).strict();

/** S-08 backend. Disabled (404 for everything, even before login) by `MOCK_GATEWAY_ENABLED=false`, see the module. */
@Roles('STUDENT')
@Controller('mock-gateway/payments')
export class MockGatewayController {
  constructor(private readonly gateway: MockGatewayService) {}

  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @Get(':paymentId')
  get(@CurrentUser() user: AuthUser, @Param('paymentId') paymentId: string): Promise<GatewayPaymentDto> {
    return this.gateway.get(user.id, uuidParam(paymentId, 'paymentId'));
  }

  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @RateLimit({ name: 'gateway-complete', limit: 10, ttlMs: MINUTE, key: (req) => `user:${req.user?.id ?? req.ip}` })
  @HttpCode(200)
  @Post(':paymentId/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('paymentId') paymentId: string,
    @Body() body: unknown,
  ): Promise<{ redirectUrl: string }> {
    return this.gateway.complete(user.id, uuidParam(paymentId, 'paymentId'), parse(completeSchema, body).result);
  }
}

type RawRequest = Request & { rawBody?: Buffer };

/** Server-to-server callback: HMAC instead of cookie/CSRF, so it opts out of the Origin check. */
@Controller('payments/webhooks')
export class PaymentWebhookController {
  private readonly logger = new Logger('PaymentWebhook');

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Public()
  @SkipOriginCheck()
  @RateLimit({ name: 'webhook-ip', limit: 60, ttlMs: MINUTE, key: (req) => `ip:${req.ip}` })
  @HttpCode(200)
  @Post('mock')
  async mock(@Req() req: RawRequest, @Headers(SIGNATURE_HEADER) signature?: string): Promise<{ status: string }> {
    const rawBody = req.rawBody;
    if (!rawBody) throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature'); // fail closed if raw body capture is off
    if (rawBody.length > MAX_WEBHOOK_BYTES) throw new PayloadTooLargeException();
    let event;
    try {
      event = await this.provider.verifyCallback({ headers: { [SIGNATURE_HEADER]: signature }, rawBody });
    } catch (error) {
      if (error instanceof InvalidSignatureError) {
        // Log the fact, never the payload (B4).
        this.logger.warn(`Rejected webhook from ${req.ip}: ${error.reason}`);
        throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid signature');
      }
      throw error;
    }
    return { status: (await this.payments.handle(event)).toLowerCase() };
  }
}
