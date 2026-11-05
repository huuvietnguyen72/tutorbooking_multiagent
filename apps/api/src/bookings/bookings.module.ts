import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_ENV } from '../common/config';
import { Clock } from '../common/clock';
import type { Env } from '../config/env';
import { MockGatewayEnabledMiddleware } from '../payments/mock-gateway-enabled.middleware';
import { MockGatewayService } from '../payments/mock-gateway.service';
import { MockPaymentProvider } from '../payments/mock-payment-provider';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider';
import { MockGatewayController, PaymentWebhookController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingStateMachine } from './booking-state-machine';
import { BookingsController, TutorBookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { PublicConfigController } from './config.controller';

@Module({
  controllers: [
    BookingsController,
    TutorBookingsController,
    MockGatewayController,
    PaymentWebhookController,
    PublicConfigController,
  ],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [APP_ENV, Clock],
      useFactory: (env: Env, clock: Clock): PaymentProvider => {
        if (env.PAYMENT_PROVIDER === 'mock') return new MockPaymentProvider(env.PAYMENT_WEBHOOK_SECRET, clock);
        throw new Error(`PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} is not implemented`);
      },
    },
    BookingStateMachine,
    BookingExpiryService,
    BookingsService,
    PaymentsService,
    MockGatewayService,
    MockGatewayEnabledMiddleware,
  ],
  exports: [BookingStateMachine, BookingExpiryService],
})
export class BookingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MockGatewayEnabledMiddleware)
      .forRoutes({ path: 'mock-gateway/*', method: RequestMethod.ALL });
  }
}
