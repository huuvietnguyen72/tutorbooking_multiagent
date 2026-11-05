import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { SIGNATURE_HEADER, signMockWebhook } from './mock-signature';
import type { MockEventBody } from './mock-payment-provider';

export interface GatewayPaymentDto {
  paymentId: string;
  bookingId: string;
  bookingCode: string;
  amountVnd: number;
  status: string;
  holdExpired: boolean;
  completable: boolean;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Server side of the S-08 mock gateway. The browser only picks a result; this service builds the
 * event, signs it with PAYMENT_WEBHOOK_SECRET and POSTs it over HTTP to the webhook route, so the
 * secret never leaves the server and only a verified webhook can change state (§2.9, B1, B4).
 */
@Injectable()
export class MockGatewayService {
  private readonly logger = new Logger(MockGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private assertEnabled(): void {
    if (!this.env.MOCK_GATEWAY_ENABLED) throw AppError.notFound();
  }

  /** Owner-only: a payment of someone else's booking is indistinguishable from an unknown id. */
  private async loadOwned(studentId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, booking: { studentId } },
      include: { booking: { select: { id: true, code: true, status: true, holdExpiresAt: true } } },
    });
    if (!payment) throw AppError.notFound();
    return payment;
  }

  private completable(payment: { status: string; failureReason: string | null; gatewayCompletedAt: Date | null }): boolean {
    return (
      payment.gatewayCompletedAt === null &&
      (payment.status === 'PENDING' || (payment.status === 'FAILED' && payment.failureReason === 'HOLD_EXPIRED'))
    );
  }

  async get(studentId: string, paymentId: string): Promise<GatewayPaymentDto> {
    this.assertEnabled();
    const payment = await this.loadOwned(studentId, paymentId);
    const { booking } = payment;
    return {
      paymentId: payment.id,
      bookingId: booking.id,
      bookingCode: `#BK-${booking.code}`,
      amountVnd: payment.amountVnd,
      status: payment.status,
      holdExpired:
        booking.status === 'EXPIRED' ||
        (booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt !== null && booking.holdExpiresAt <= this.clock.now()),
      completable: this.completable(payment),
    };
  }

  async complete(studentId: string, paymentId: string, result: 'SUCCESS' | 'FAILURE'): Promise<{ redirectUrl: string }> {
    this.assertEnabled();
    const payment = await this.loadOwned(studentId, paymentId);
    if (payment.gatewayCompletedAt) throw new AppError(409, 'GATEWAY_ALREADY_COMPLETED', 'Payment was already completed at the gateway');
    if (!this.completable(payment)) throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Booking can no longer be paid');

    // Claim the single completion atomically: a double click or a replay loses here.
    const claimed = await this.prisma.payment.updateMany({
      where: {
        id: payment.id,
        gatewayCompletedAt: null,
        OR: [{ status: 'PENDING' }, { status: 'FAILED', failureReason: 'HOLD_EXPIRED' }],
      },
      data: { gatewayCompletedAt: this.clock.now() },
    });
    if (claimed.count === 0) throw new AppError(409, 'GATEWAY_ALREADY_COMPLETED', 'Payment was already completed at the gateway');

    const event: MockEventBody = {
      eventId: `evt_${randomUUID()}`,
      providerRef: payment.providerRef,
      outcome: result === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED',
      amountVnd: payment.amountVnd,
      occurredAt: this.clock.now().toISOString(),
    };
    await this.dispatch(payment.id, event);
    return { redirectUrl: `/thanh-toan/${payment.booking.id}/ket-qua` };
  }

  private async dispatch(paymentId: string, event: MockEventBody): Promise<void> {
    const rawBody = Buffer.from(JSON.stringify(event));
    const url = `${this.env.INTERNAL_WEBHOOK_BASE_URL}/api/v1/payments/webhooks/mock`;
    let status: number | null = null;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signMockWebhook(this.env.PAYMENT_WEBHOOK_SECRET, this.clock.now(), rawBody),
        },
        body: rawBody,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      await res.arrayBuffer().catch(() => undefined);
    } catch (error) {
      this.logger.error(`Mock webhook dispatch failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
    // 429 (shared webhook rate-limit bucket) means the event was not processed, same as a 5xx.
    if (status !== null && status < 500 && status !== 429) {
      if (status >= 400) this.logger.warn(`Mock webhook for payment ${paymentId} answered ${status}`);
      return;
    }
    // Delivery failed: let the shopper try again instead of burning the single completion.
    await this.prisma.payment.update({ where: { id: paymentId }, data: { gatewayCompletedAt: null } });
    throw new AppError(502, 'INTERNAL_ERROR', 'Payment gateway is unavailable');
  }
}
