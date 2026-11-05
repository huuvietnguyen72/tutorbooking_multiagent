import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { BookingExpiryService, TX_OPTIONS } from '../bookings/booking-expiry.service';
import { BookingStateMachine } from '../bookings/booking-state-machine';
import { cancellationPolicy } from '../bookings/booking.policy';
import { flag, StudentBookingRow, toStudentBooking } from '../bookings/bookings.dto';
import { Page } from '../bookings/bookings.service';
import {
  AdminBookingDetailDto,
  AdminBookingDto,
  AdminPaymentDto,
  toAdminPayment,
  toHistoryEntry,
  toPaymentEventEntry,
} from './admin.dto';

const partyWithEmail = { select: { id: true, fullName: true, email: true } } as const;
const listInclude = { payment: true, tutor: partyWithEmail, student: partyWithEmail, review: true } satisfies Prisma.BookingInclude;
const detailInclude = {
  ...listInclude,
  payment: { include: { events: { orderBy: { receivedAt: 'asc' } } } },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.BookingInclude;

type DetailRow = Prisma.BookingGetPayload<{ include: typeof detailInclude }>;
type ListRow = Prisma.BookingGetPayload<{ include: typeof listInclude }>;

export interface BookingFilter {
  status?: string;
  tutorId?: string;
  studentId?: string;
  from?: Date;
  to?: Date;
  refundFailed?: 'true';
}

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly machine: BookingStateMachine,
    private readonly expiry: BookingExpiryService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private get cfg() {
    return { cancellationWindowHours: this.env.CANCELLATION_WINDOW_HOURS };
  }

  /** Admin names for `payments.refunded_by`, fetched in one query. */
  private async adminNames(rows: { payment: { refundedBy: string | null } | null }[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.payment?.refundedBy).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private toDto(row: ListRow, names: Map<string, string>, withServerTime = false): AdminBookingDto {
    const now = this.clock.now();
    const base = toStudentBooking(row as unknown as StudentBookingRow, now, this.cfg, withServerTime);
    const payment = row.payment!;
    return {
      ...base,
      payment: toAdminPayment(payment, payment.refundedBy ? (names.get(payment.refundedBy) ?? null) : null),
      // The admin's cancel button follows the admin rule (any time before the session), not the student's.
      actions: { ...base.actions, cancel: flag(cancellationPolicy(row, 'ADMIN', now, this.cfg)) },
    };
  }

  async list(filter: BookingFilter, page: number, pageSize: number): Promise<Page<AdminBookingDto>> {
    const where: Prisma.BookingWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.tutorId ? { tutorId: filter.tutorId } : {}),
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.from || filter.to ? { startAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      ...(filter.refundFailed === 'true' ? { payment: { is: { status: 'PAID', refundFailed: true } } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
      }),
      this.prisma.booking.count({ where }),
    ]);
    const names = await this.adminNames(rows);
    return { items: rows.map((r) => this.toDto(r, names)), page, pageSize, total };
  }

  async get(bookingId: string): Promise<AdminBookingDetailDto> {
    await this.expiry.expireDueFor({ bookingId }); // an overdue hold reads as EXPIRED, like everywhere else (§2.3)
    const row = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: detailInclude });
    if (!row) throw AppError.notFound();
    return this.toDetail(row);
  }

  private async toDetail(row: DetailRow): Promise<AdminBookingDetailDto> {
    const names = await this.adminNames([row]);
    return {
      ...this.toDto(row, names, true),
      studentEmail: row.student.email,
      tutorEmail: row.tutor.email,
      history: row.history.map(toHistoryEntry),
      paymentEvents: row.payment!.events.map(toPaymentEventEntry),
    };
  }

  /** CONFIRMED and not started -> CANCELLED_BY_ADMIN, slot CLOSED, refund unless the admin opts out (US-ADM-03). */
  async cancel(adminId: string, bookingId: string, reason: string, refund: boolean): Promise<AdminBookingDetailDto> {
    await this.expiry.expireDueFor({ bookingId });
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.machine.lockBooking(tx, bookingId);
      if (!locked) throw AppError.notFound();
      const decision = cancellationPolicy(locked, 'ADMIN', this.clock.now(), this.cfg);
      if (!decision.allowed) throw new AppError(409, decision.code, 'Booking cannot be cancelled');
      const next = await this.machine.cancelConfirmed(tx, locked, 'ADMIN', adminId, reason, { refund });
      await recordAudit(tx, {
        actorId: adminId,
        action: 'BOOKING_CANCELLED_BY_ADMIN',
        entityType: 'booking',
        entityId: bookingId,
        reason,
        metadata: { refundRequested: refund, paymentStatus: next.payment?.status ?? null, refundFailed: next.payment?.refundFailed ?? false },
      });
    }, TX_OPTIONS);
    return this.get(bookingId);
  }

  /**
   * Manual refund of a PAID payment whose booking is cancelled/expired or already held (US-ADM-04).
   * Locks the booking first, so a second click waits and then sees REFUNDED (409). A provider error
   * keeps the payment PAID with `refundFailed` set and is returned as such, so the admin can retry.
   */
  async refund(adminId: string, paymentId: string, reason: string): Promise<AdminPaymentDto> {
    const found = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { bookingId: true } });
    if (!found) throw AppError.notFound();
    return this.prisma.$transaction(async (tx) => {
      const booking = await this.machine.lockBooking(tx, found.bookingId);
      const payment = booking?.payment;
      if (!booking || !payment || payment.id !== paymentId) throw AppError.notFound();
      if (payment.status === 'REFUNDED') throw new AppError(409, 'ALREADY_REFUNDED', 'Payment was already refunded');
      const sessionOver = booking.endAt.getTime() <= this.clock.now().getTime();
      if (payment.status !== 'PAID' || (booking.status === 'CONFIRMED' && !sessionOver)) {
        throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'Payment cannot be refunded in its current state');
      }
      const refunded = await this.machine.refund(tx, payment, reason, adminId);
      await recordAudit(tx, {
        actorId: adminId,
        action: refunded ? 'PAYMENT_REFUNDED' : 'PAYMENT_REFUND_FAILED',
        entityType: 'payment',
        entityId: paymentId,
        reason,
        metadata: { bookingId: booking.id, bookingStatus: booking.status },
      });
      const next = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { fullName: true } });
      return toAdminPayment(next, next.refundedBy ? (admin?.fullName ?? null) : null);
    }, TX_OPTIONS);
  }
}
