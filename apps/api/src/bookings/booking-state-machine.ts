import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ActorType, Booking, BookingStatus, Payment, Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider';
import { formatBookingCode } from './booking-code';
import { isHoldExpired } from './booking.policy';

export type Tx = Prisma.TransactionClient;

export type BookingWithParties = Booking & {
  payment: Payment | null;
  student: { id: string; email: string; fullName: string };
  tutor: { id: string; email: string; fullName: string };
};

export interface Actor {
  type: ActorType;
  id: string | null;
}

export const SYSTEM: Actor = { type: 'SYSTEM', id: null };
export const PROVIDER: Actor = { type: 'PROVIDER', id: null };

export type PaymentFailure = 'HOLD_EXPIRED' | 'DECLINED' | 'CANCELLED_BY_STUDENT';

/**
 * The only place that writes `bookings.status` (§2.4). Every method runs inside the caller's
 * transaction and expects the booking row to be locked already (`lockBooking`).
 *
 * Lock order is always booking -> slot(s, ascending id) to rule out deadlocks between the webhook,
 * the expiry job, cancel and (T5) reschedule (A4).
 */
@Injectable()
export class BookingStateMachine {
  private readonly logger = new Logger(BookingStateMachine.name);

  constructor(
    private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** `SELECT … FOR UPDATE` on the booking, then loads it with payment and both parties. */
  async lockBooking(tx: Tx, bookingId: string): Promise<BookingWithParties | null> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    return rows.length === 0 ? null : this.load(tx, bookingId);
  }

  load(tx: Tx, id: string): Promise<BookingWithParties | null> {
    return tx.booking.findUnique({
      where: { id },
      include: {
        payment: true,
        student: { select: { id: true, email: true, fullName: true } },
        tutor: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  /** Locks slots in ascending id order regardless of the order asked for (A4). */
  async lockSlots(tx: Tx, slotIds: string[]): Promise<void> {
    for (const id of [...new Set(slotIds)].sort()) {
      await tx.$queryRaw`SELECT id FROM slots WHERE id = ${id}::uuid FOR UPDATE`;
    }
  }

  private async history(
    tx: Tx,
    booking: Booking,
    to: BookingStatus,
    actor: Actor,
    note?: string,
  ): Promise<void> {
    await tx.bookingHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: to,
        fromSlotId: booking.slotId,
        toSlotId: booking.slotId,
        actorId: actor.id,
        actorType: actor.type,
        note,
      },
    });
  }

  /**
   * Lazy expiry (§2.3): turns an overdue hold into EXPIRED inside the current transaction.
   * Returns the (possibly updated) booking.
   */
  async expireIfDue(tx: Tx, booking: BookingWithParties): Promise<BookingWithParties> {
    if (!isHoldExpired(booking, this.clock.now())) return booking;
    return this.expire(tx, booking, 'HOLD_EXPIRED', SYSTEM);
  }

  /** PENDING_PAYMENT -> EXPIRED; payment PENDING -> FAILED; slot HELD -> AVAILABLE. */
  async expire(tx: Tx, booking: BookingWithParties, reason: PaymentFailure, actor: Actor): Promise<BookingWithParties> {
    if (booking.status !== 'PENDING_PAYMENT') return booking;
    const now = this.clock.now();
    await this.lockSlots(tx, [booking.slotId]);
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
    if (booking.payment?.status === 'PENDING') {
      await tx.payment.update({
        where: { id: booking.payment.id },
        data: { status: 'FAILED', failureReason: reason, failedAt: now },
      });
    }
    await tx.slot.updateMany({ where: { id: booking.slotId, status: 'HELD' }, data: { status: 'AVAILABLE' } });
    await this.history(tx, booking, 'EXPIRED', actor, reason);
    return this.reload(tx, booking.id);
  }

  /** PENDING_PAYMENT (still within hold) + SUCCEEDED: booking CONFIRMED, payment PAID, slot BOOKED, emails queued. */
  async confirm(tx: Tx, booking: BookingWithParties): Promise<BookingWithParties> {
    const now = this.clock.now();
    await this.lockSlots(tx, [booking.slotId]);
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED', holdExpiresAt: null } });
    await tx.payment.update({ where: { id: booking.payment!.id }, data: { status: 'PAID', paidAt: now } });
    await tx.slot.update({ where: { id: booking.slotId }, data: { status: 'BOOKED' } });
    await this.history(tx, booking, 'CONFIRMED', PROVIDER, 'PAID');
    const next = await this.reload(tx, booking.id);
    await this.enqueue(tx, next, 'booking_confirmed', ['student', 'tutor']);
    return next;
  }

  /**
   * CONFIRMED -> CANCELLED_BY_STUDENT | CANCELLED_BY_TUTOR with a 100% refund.
   * Student frees the slot; tutor closes it (A6).
   */
  async cancelConfirmed(
    tx: Tx,
    booking: BookingWithParties,
    by: 'STUDENT' | 'TUTOR',
    actorId: string,
    reason: string | null,
  ): Promise<BookingWithParties> {
    const to: BookingStatus = by === 'STUDENT' ? 'CANCELLED_BY_STUDENT' : 'CANCELLED_BY_TUTOR';
    await this.lockSlots(tx, [booking.slotId]);
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: to, cancelledAt: this.clock.now(), cancelledBy: actorId, cancelReason: reason },
    });
    await tx.slot.update({ where: { id: booking.slotId }, data: { status: by === 'STUDENT' ? 'AVAILABLE' : 'CLOSED' } });
    await this.history(tx, booking, to, { type: 'USER', id: actorId }, reason ?? undefined);
    if (booking.payment?.status === 'PAID') await this.refund(tx, booking.payment, `${to}`);
    const next = await this.reload(tx, booking.id);
    await this.enqueue(tx, next, 'booking_cancelled', ['student', 'tutor'], { cancelledBy: by });
    return next;
  }

  /**
   * PAID -> REFUNDED through the provider (idempotent on payment id). A provider failure leaves the
   * payment PAID with `refund_failed` so Admin can retry by hand (§2.5).
   */
  async refund(tx: Tx, payment: Payment, reason: string, refundedBy: string | null = null): Promise<boolean> {
    // TODO(VNPay): the provider call runs inside the caller's transaction; fine for Mock, move it out before a real provider.
    const now = this.clock.now();
    await tx.payment.update({ where: { id: payment.id }, data: { refundRequestedAt: now } });
    try {
      const result = await this.provider.refund({
        paymentId: payment.id,
        providerRef: payment.providerRef,
        amountVnd: payment.amountVnd,
        reason,
        idempotencyKey: payment.id,
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED', refundedAt: now, refundRef: result.refundRef, refundFailed: false, refundedBy },
      });
      return true;
    } catch (error) {
      this.logger.error(`Refund failed for payment ${payment.id}: ${error instanceof Error ? error.message : 'unknown'}`);
      await tx.payment.update({ where: { id: payment.id }, data: { refundFailed: true } });
      return false;
    }
  }

  private async reload(tx: Tx, id: string): Promise<BookingWithParties> {
    return (await this.load(tx, id))!;
  }

  /** Transactional outbox (§2.6): rows are written with the state change; the worker ships them (T5). */
  async enqueue(
    tx: Tx,
    booking: BookingWithParties,
    template: 'booking_confirmed' | 'booking_cancelled',
    to: ('student' | 'tutor')[],
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    for (const role of to) {
      const party = role === 'student' ? booking.student : booking.tutor;
      await tx.emailOutbox.create({
        data: {
          toEmail: party.email,
          template: `${template}_${role}`,
          payload: {
            bookingId: booking.id,
            bookingCode: formatBookingCode(booking.code),
            startAt: booking.startAt.toISOString(),
            endAt: booking.endAt.toISOString(),
            priceVnd: booking.priceVnd,
            studentName: booking.student.fullName,
            tutorName: booking.tutor.fullName,
            ...extra,
          },
        },
      });
    }
  }
}
