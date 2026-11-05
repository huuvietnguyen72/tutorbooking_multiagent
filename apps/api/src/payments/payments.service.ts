import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { TX_OPTIONS } from '../bookings/booking-expiry.service';
import { BookingStateMachine, PROVIDER, Tx } from '../bookings/booking-state-machine';
import { isHoldExpired } from '../bookings/booking.policy';
import { PAYMENT_PROVIDER, PaymentProvider, VerifiedPaymentEvent } from './payment-provider';

export type WebhookResult = 'APPLIED' | 'DUPLICATE' | 'IGNORED';

type Rejection = { code: 'AMOUNT_MISMATCH' | 'UNKNOWN_PAYMENT' };

/** Keeps a short tail for support; the full reference is a bearer-ish token (B6). */
const maskRef = (ref: string): string => `***${ref.slice(-4)}`;

/** Applies verified provider events to payments/bookings (§2.4 table). Provider-agnostic. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly machine: BookingStateMachine,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * One transaction: INSERT … ON CONFLICT DO NOTHING (idempotency) -> lock booking -> apply.
   * Rejections (amount/ref mismatch) are recorded on the event row and surface as 400 after commit,
   * so the audit trail survives while no booking state changes.
   */
  async handle(event: VerifiedPaymentEvent): Promise<WebhookResult> {
    const outcome = await this.prisma.$transaction((tx) => this.apply(tx, event), TX_OPTIONS);
    if (outcome === 'AMOUNT_MISMATCH') throw new AppError(400, 'AMOUNT_MISMATCH', 'Amount does not match the payment');
    if (outcome === 'UNKNOWN_PAYMENT') throw new AppError(400, 'UNKNOWN_PAYMENT', 'Unknown payment reference');
    return outcome;
  }

  private async apply(tx: Tx, event: VerifiedPaymentEvent): Promise<WebhookResult | Rejection['code']> {
    const provider = this.provider.name;
    const now = this.clock.now();
    const payload = {
      eventId: event.eventId,
      providerRef: maskRef(event.providerRef),
      outcome: event.outcome,
      amountVnd: event.amountVnd,
      occurredAt: event.occurredAt.toISOString(),
    };
    const inserted = await tx.$executeRaw`
      INSERT INTO payment_events (id, provider, event_id, outcome, payload, received_at)
      VALUES (${randomUUID()}::uuid, ${provider}, ${event.eventId}, ${event.outcome}, ${JSON.stringify(payload)}::jsonb, ${now})
      ON CONFLICT (provider, event_id) DO NOTHING`;
    if (inserted === 0) return 'DUPLICATE';

    const settle = async (paymentId: string | null, rejectedReason: string | null = null): Promise<void> => {
      await tx.paymentEvent.update({
        where: { provider_eventId: { provider, eventId: event.eventId } },
        data: { paymentId, rejectedReason, processedAt: this.clock.now() },
      });
    };

    const found = await tx.payment.findUnique({ where: { providerRef: event.providerRef }, select: { id: true, bookingId: true } });
    if (!found) {
      await settle(null, 'UNKNOWN_PAYMENT');
      return 'UNKNOWN_PAYMENT';
    }

    // Same lock the expiry job takes: whoever gets it first wins, the other re-reads (§2.3).
    const booking = await this.machine.lockBooking(tx, found.bookingId);
    const payment = booking?.payment;
    if (!booking || !payment) {
      await settle(found.id, 'UNKNOWN_PAYMENT');
      return 'UNKNOWN_PAYMENT';
    }
    if (payment.amountVnd !== event.amountVnd) {
      await settle(payment.id, 'AMOUNT_MISMATCH');
      return 'AMOUNT_MISMATCH';
    }

    // Overdue holds are expired first, so a SUCCEEDED after the deadline takes the "late" path.
    const current = isHoldExpired(booking, now) ? await this.machine.expireIfDue(tx, booking) : booking;
    const pay = current.payment!;

    if (current.status === 'PENDING_PAYMENT') {
      if (event.outcome === 'SUCCEEDED') await this.machine.confirm(tx, current);
      else await this.machine.expire(tx, current, 'DECLINED', PROVIDER);
      await settle(pay.id);
      return 'APPLIED';
    }

    if (current.status === 'EXPIRED' && event.outcome === 'SUCCEEDED' && pay.status === 'FAILED') {
      // Money arrived after the hold ended (timeout, decline or student cancel mid-payment):
      // never confirm, take it and give it back (AC8).
      await tx.payment.update({ where: { id: pay.id }, data: { status: 'PAID', failureReason: null, paidAt: now } });
      const refunded = await this.machine.refund(tx, { ...pay, status: 'PAID' }, 'LATE_PAYMENT');
      await tx.auditLog.create({
        data: {
          actorId: null,
          action: 'LATE_PAYMENT_AUTO_REFUND',
          entityType: 'payment',
          entityId: pay.id,
          reason: 'Payment arrived after the booking hold ended',
          metadata: { bookingId: current.id, eventId: event.eventId, refunded },
        },
      });
      await settle(pay.id);
      return 'APPLIED';
    }

    // Duplicates of a settled outcome are harmless (CONFIRMED + SUCCEEDED, EXPIRED + FAILED, REFUNDED + SUCCEEDED);
    // anything else is out of order and is recorded, not applied.
    const harmless =
      (current.status === 'CONFIRMED' && event.outcome === 'SUCCEEDED') || (current.status === 'EXPIRED' && event.outcome === 'FAILED');
    await settle(pay.id, harmless ? null : 'OUT_OF_ORDER');
    return 'IGNORED';
  }
}
