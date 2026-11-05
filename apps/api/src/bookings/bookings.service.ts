import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment-provider';
import { BookingExpiryService, TX_OPTIONS } from './booking-expiry.service';
import { BookingStateMachine, Tx } from './booking-state-machine';
import { formatBookingCode } from './booking-code';
import { cancellationPolicy, isHoldExpired, reschedulePolicy } from './booking.policy';
import {
  StudentBookingDto,
  studentBookingInclude,
  StudentBookingRow,
  toStudentBooking,
  TutorBookingDto,
  toTutorBooking,
} from './bookings.dto';

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CheckoutDto {
  booking: StudentBookingDto;
  checkoutUrl: string;
  serverTime: string;
}

type Scope = 'upcoming' | 'past' | 'cancelled';

interface SlotRow {
  id: string;
  tutorId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  deletedAt: Date | null;
}

/** Postgres SQLSTATE of a failed statement, however Prisma wrapped it. */
function sqlState(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return '23505';
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code) return meta.code;
  }
  const message = error instanceof Error ? error.message : '';
  // Constraint kinds Prisma does not model reach us as an unknown error whose text carries the SQLSTATE.
  const code = /code: "(\w{5})"/.exec(message)?.[1];
  if (code) return code;
  if (/violates exclusion constraint/.test(message)) return '23P01';
  if (/unique constraint/i.test(message)) return '23505';
  return null;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly machine: BookingStateMachine,
    private readonly expiry: BookingExpiryService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private get cfg() {
    return { cancellationWindowHours: this.env.CANCELLATION_WINDOW_HOURS };
  }

  private async loadOwned(studentId: string, bookingId: string): Promise<StudentBookingRow> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, studentId }, // ownership in the query: foreign ids look unknown (404)
      include: studentBookingInclude,
    });
    if (!booking) throw AppError.notFound();
    return booking;
  }

  /** Reads the booking, lazily expiring an overdue hold first (§2.3). */
  private async loadFresh(studentId: string, bookingId: string): Promise<StudentBookingRow> {
    const booking = await this.loadOwned(studentId, bookingId);
    if (!isHoldExpired(booking, this.clock.now())) return booking;
    await this.expiry.expireOne(bookingId);
    return this.loadOwned(studentId, bookingId);
  }

  private checkout(booking: StudentBookingRow, checkoutUrl: string): CheckoutDto {
    const now = this.clock.now();
    return {
      booking: toStudentBooking(booking, now, this.cfg, true),
      checkoutUrl,
      serverTime: now.toISOString(),
    };
  }

  // ---- create ----

  async create(studentId: string, slotId: string, idempotencyKey?: string): Promise<CheckoutDto> {
    if (idempotencyKey) {
      const replay = await this.replayIdempotent(studentId, idempotencyKey);
      if (replay) return replay;
    }
    // Overdue holds on this slot or by this student must not block the new booking (job may lag).
    await this.expiry.expireDueFor({ slotId });
    await this.expiry.expireDueFor({ studentId });

    let created: StudentBookingRow;
    try {
      created = await this.prisma.$transaction((tx) => this.createInTx(tx, studentId, slotId, idempotencyKey), TX_OPTIONS);
    } catch (error) {
      const mapped = await this.mapCreateError(error, studentId, slotId, idempotencyKey);
      if (!(mapped instanceof IdempotentReplay)) throw mapped;
      const booking = await this.loadFresh(studentId, mapped.bookingId);
      return this.checkout(booking, this.provider.checkoutUrl(booking.payment!.id));
    }

    // Provider call happens after commit: no network I/O while rows are locked.
    const payment = created.payment!;
    const session = await this.provider.createPayment({
      paymentId: payment.id,
      bookingId: created.id,
      amountVnd: payment.amountVnd,
      description: `Thanh toán ${formatBookingCode(created.code)}`,
      returnUrl: `${new URL(this.env.APP_BASE_URL).origin}/thanh-toan/${created.id}/ket-qua`,
      expiresAt: created.holdExpiresAt!,
    });
    await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: session.providerRef } });
    return this.checkout(await this.loadOwned(studentId, created.id), session.checkoutUrl);
  }

  private async replayIdempotent(studentId: string, key: string): Promise<CheckoutDto | null> {
    const now = this.clock.now();
    // The key only dedupes inside the hold window; afterwards it is released for reuse.
    await this.prisma.booking.updateMany({
      where: { studentId, idempotencyKey: key, createdAt: { lt: new Date(now.getTime() - this.env.BOOKING_HOLD_MINUTES * 60_000) } },
      data: { idempotencyKey: null },
    });
    const existing = await this.prisma.booking.findFirst({ where: { studentId, idempotencyKey: key }, select: { id: true } });
    if (!existing) return null;
    const booking = await this.loadFresh(studentId, existing.id);
    return this.checkout(booking, this.provider.checkoutUrl(booking.payment!.id));
  }

  private async createInTx(tx: Tx, studentId: string, slotId: string, idempotencyKey?: string): Promise<StudentBookingRow> {
    const now = this.clock.now();
    // One booking insert per student at a time: two parallel inserts racing on the
    // `bookings_student_no_overlap` exclusion constraint deadlock each other (40P01 -> 500).
    // Taken before any row lock, so it cannot invert the booking -> slot lock order.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studentId}, 0))`;
    const [slot] = await tx.$queryRaw<SlotRow[]>`
      SELECT id, tutor_id AS "tutorId", start_at AS "startAt", end_at AS "endAt", status, deleted_at AS "deletedAt"
      FROM slots WHERE id = ${slotId}::uuid FOR UPDATE`;
    if (!slot || slot.deletedAt || slot.status === 'CLOSED') throw AppError.notFound();
    if (idempotencyKey) {
      // A parallel request with the same key may have just taken this slot: answer with its booking.
      const twin = await tx.booking.findFirst({ where: { studentId, idempotencyKey }, select: { id: true } });
      if (twin) throw new IdempotentReplay(twin.id);
    }

    const profile = await tx.tutorProfile.findUnique({
      where: { userId: slot.tutorId },
      select: { approvalStatus: true, pricePerSessionVnd: true, user: { select: { status: true } } },
    });
    if (!profile || profile.approvalStatus !== 'APPROVED' || !profile.pricePerSessionVnd || profile.user.status !== 'ACTIVE') {
      throw new AppError(409, 'TUTOR_NOT_ACCEPTING', 'Tutor is not accepting bookings');
    }
    if (slot.status !== 'AVAILABLE') throw new AppError(409, 'SLOT_UNAVAILABLE', 'Slot is no longer available');
    if (slot.startAt.getTime() < now.getTime() + this.env.MIN_BOOKING_LEAD_MINUTES * 60_000) {
      throw new AppError(409, 'SLOT_TOO_SOON', 'Slot starts too soon to book');
    }
    const conflict = await this.findStudentConflict(tx, studentId, slot.startAt, slot.endAt);
    if (conflict) throw conflict;

    const booking = await tx.booking.create({
      data: {
        studentId, // always from the session, never the body
        tutorId: slot.tutorId,
        slotId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        priceVnd: profile.pricePerSessionVnd,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date(now.getTime() + this.env.BOOKING_HOLD_MINUTES * 60_000),
        idempotencyKey: idempotencyKey ?? null,
        payment: {
          create: {
            provider: this.provider.name,
            providerRef: `pending:${randomUUID()}`, // replaced by the provider's reference right after commit
            amountVnd: profile.pricePerSessionVnd,
          },
        },
      },
      include: studentBookingInclude,
    });
    await tx.slot.update({ where: { id: slotId }, data: { status: 'HELD' } });
    await tx.bookingHistory.create({
      data: { bookingId: booking.id, fromStatus: null, toStatus: 'PENDING_PAYMENT', toSlotId: slotId, actorId: studentId, actorType: 'USER' },
    });
    return booking;
  }

  private async findStudentConflict(
    tx: Tx | PrismaService,
    studentId: string,
    startAt: Date,
    endAt: Date,
    exceptBookingId?: string,
  ): Promise<AppError | null> {
    const other = await tx.booking.findFirst({
      where: {
        studentId,
        status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
        ...(exceptBookingId ? { id: { not: exceptBookingId } } : {}),
      },
      include: { tutor: { select: { fullName: true } } },
    });
    if (!other) return null;
    return new AppError(409, 'STUDENT_OVERLAP', 'You already have a booking at this time', {
      conflictingBooking: {
        id: other.id,
        code: formatBookingCode(other.code),
        startAt: other.startAt.toISOString(),
        endAt: other.endAt.toISOString(),
        tutorName: other.tutor.fullName,
      },
    });
  }

  /** Constraint violations (the last safety net under the row locks) become the documented 409s. */
  private async mapCreateError(error: unknown, studentId: string, slotId: string, key?: string): Promise<unknown> {
    if (error instanceof AppError || error instanceof IdempotentReplay) return error;
    const state = sqlState(error);
    if (state === '23505' && key) {
      // Same Idempotency-Key raced in a parallel request: hand back that booking.
      const existing = await this.prisma.booking.findFirst({ where: { studentId, idempotencyKey: key }, select: { id: true } });
      if (existing) return new IdempotentReplay(existing.id);
    }
    if (state === '23505') return new AppError(409, 'SLOT_UNAVAILABLE', 'Slot is no longer available');
    if (state === '23P01') {
      const slot = await this.prisma.slot.findUnique({ where: { id: slotId }, select: { startAt: true, endAt: true } });
      const conflict = slot ? await this.findStudentConflict(this.prisma, studentId, slot.startAt, slot.endAt) : null;
      return conflict ?? new AppError(409, 'STUDENT_OVERLAP', 'You already have a booking at this time');
    }
    return error;
  }

  // ---- read ----

  async list(studentId: string, scope: Scope, page: number, pageSize: number): Promise<Page<StudentBookingDto>> {
    await this.expiry.expireDueFor({ studentId });
    const now = this.clock.now();
    const where: Prisma.BookingWhereInput = { studentId };
    const orderBy: Prisma.BookingOrderByWithRelationInput = { startAt: scope === 'upcoming' ? 'asc' : 'desc' };
    if (scope === 'upcoming') {
      where.OR = [
        { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        { status: 'CONFIRMED', endAt: { gt: now } },
      ];
    } else if (scope === 'past') {
      Object.assign(where, { status: 'CONFIRMED', endAt: { lte: now } });
    } else {
      where.status = { in: ['EXPIRED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'] };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: studentBookingInclude }),
      this.prisma.booking.count({ where }),
    ]);
    return { items: items.map((b) => toStudentBooking(b, now, this.cfg)), page, pageSize, total };
  }

  async get(studentId: string, bookingId: string): Promise<StudentBookingDto> {
    const booking = await this.loadFresh(studentId, bookingId);
    return toStudentBooking(booking, this.clock.now(), this.cfg, true);
  }

  async resumeCheckout(studentId: string, bookingId: string): Promise<CheckoutDto> {
    const booking = await this.loadFresh(studentId, bookingId);
    if (booking.status !== 'PENDING_PAYMENT') throw new AppError(409, 'BOOKING_NOT_PAYABLE', 'Booking can no longer be paid');
    return this.checkout(booking, this.provider.checkoutUrl(booking.payment!.id));
  }

  // ---- cancel ----

  async cancel(studentId: string, bookingId: string, reason: string | null): Promise<StudentBookingDto> {
    await this.loadFresh(studentId, bookingId); // 404 before taking any lock; settles an overdue hold
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await this.machine.lockBooking(tx, bookingId);
      if (!locked || locked.studentId !== studentId) return { denied: 'NOT_FOUND' as const };
      const now = this.clock.now();
      const decision = cancellationPolicy(locked, 'STUDENT', now, this.cfg);
      if (!decision.allowed) return { denied: decision.code };
      if (decision.effect === 'RELEASE_HOLD') {
        await this.machine.expire(tx, locked, 'CANCELLED_BY_STUDENT', { type: 'USER', id: studentId });
      } else {
        await this.machine.cancelConfirmed(tx, locked, 'STUDENT', studentId, reason);
      }
      return { denied: null };
    }, TX_OPTIONS);
    if (outcome.denied === 'NOT_FOUND') throw AppError.notFound();
    if (outcome.denied) throw new AppError(409, outcome.denied, 'Booking cannot be cancelled');
    return this.get(studentId, bookingId);
  }

  // ---- reschedule ----

  async reschedule(studentId: string, bookingId: string, newSlotId: string): Promise<StudentBookingDto> {
    await this.loadFresh(studentId, bookingId); // 404 before taking any lock
    await this.expiry.expireDueFor({ studentId }); // an overdue hold of this student must not block the new time
    try {
      await this.prisma.$transaction((tx) => this.rescheduleInTx(tx, studentId, bookingId, newSlotId), TX_OPTIONS);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const state = sqlState(error);
      // Constraints are only the last safety net under the locks below.
      if (state === '23P01') throw new AppError(409, 'STUDENT_OVERLAP', 'You already have a booking at this time');
      if (state === '23505') throw new AppError(409, 'SLOT_UNAVAILABLE', 'Slot is no longer available');
      throw error;
    }
    return this.get(studentId, bookingId);
  }

  private async rescheduleInTx(tx: Tx, studentId: string, bookingId: string, newSlotId: string): Promise<void> {
    const now = this.clock.now();
    // Same per-student serialization as create(): exclusion-constraint writes of one student must not deadlock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${studentId}, 0))`;
    const locked = await this.machine.lockBooking(tx, bookingId);
    if (!locked || locked.studentId !== studentId) throw AppError.notFound();
    const decision = reschedulePolicy(locked, now, this.cfg);
    if (!decision.allowed) throw new AppError(409, decision.code, 'Booking cannot be rescheduled');

    await this.machine.lockSlots(tx, [locked.slotId, newSlotId]); // ascending id order (A4)
    const target = await tx.slot.findUnique({ where: { id: newSlotId } });
    if (!target || target.deletedAt || target.status === 'CLOSED') throw AppError.notFound();
    const sameDuration = target.endAt.getTime() - target.startAt.getTime() === locked.endAt.getTime() - locked.startAt.getTime();
    if (target.tutorId !== locked.tutorId || !sameDuration || target.id === locked.slotId || target.status !== 'AVAILABLE') {
      throw new AppError(409, 'SLOT_UNAVAILABLE', 'Slot is not available for this booking');
    }
    if (target.startAt.getTime() < now.getTime() + this.env.MIN_BOOKING_LEAD_MINUTES * 60_000) {
      throw new AppError(409, 'SLOT_TOO_SOON', 'Slot starts too soon to book');
    }
    const profile = await tx.tutorProfile.findUnique({
      where: { userId: target.tutorId },
      select: { approvalStatus: true, user: { select: { status: true } } },
    });
    if (!profile || profile.approvalStatus !== 'APPROVED' || profile.user.status !== 'ACTIVE') {
      throw new AppError(409, 'TUTOR_NOT_ACCEPTING', 'Tutor is not accepting bookings');
    }
    const conflict = await this.findStudentConflict(tx, studentId, target.startAt, target.endAt, bookingId);
    if (conflict) throw conflict;

    await this.machine.reschedule(tx, locked, target, studentId);
  }

  // ---- tutor side ----

  async listForTutor(tutorId: string, scope: Scope, page: number, pageSize: number): Promise<Page<TutorBookingDto>> {
    const now = this.clock.now();
    const where: Prisma.BookingWhereInput = { tutorId };
    if (scope === 'upcoming') Object.assign(where, { status: 'CONFIRMED', endAt: { gt: now } });
    else if (scope === 'past') Object.assign(where, { status: 'CONFIRMED', endAt: { lte: now } });
    else where.status = { in: ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'] };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({
        where,
        orderBy: { startAt: scope === 'upcoming' ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { student: { select: { fullName: true } } },
      }),
      this.prisma.booking.count({ where }),
    ]);
    return { items: items.map((b) => toTutorBooking(b, now, this.cfg)), page, pageSize, total };
  }

  private async loadForTutor(tutorId: string, bookingId: string) {
    // PENDING_PAYMENT and EXPIRED never reached the tutor (Q6): same 404 as an unknown id.
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        tutorId,
        status: { in: ['CONFIRMED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'] },
      },
      include: { student: { select: { fullName: true } } },
    });
    if (!booking) throw AppError.notFound();
    return booking;
  }

  async getForTutor(tutorId: string, bookingId: string): Promise<TutorBookingDto> {
    return toTutorBooking(await this.loadForTutor(tutorId, bookingId), this.clock.now(), this.cfg);
  }

  async cancelByTutor(tutorId: string, bookingId: string, reason: string): Promise<TutorBookingDto> {
    await this.loadForTutor(tutorId, bookingId);
    const denied = await this.prisma.$transaction(async (tx) => {
      const locked = await this.machine.lockBooking(tx, bookingId);
      if (!locked || locked.tutorId !== tutorId) return 'NOT_FOUND' as const;
      const decision = cancellationPolicy(locked, 'TUTOR', this.clock.now(), this.cfg);
      if (!decision.allowed) return decision.code;
      await this.machine.cancelConfirmed(tx, locked, 'TUTOR', tutorId, reason);
      return null;
    }, TX_OPTIONS);
    if (denied === 'NOT_FOUND') throw AppError.notFound();
    if (denied) throw new AppError(409, denied, 'Booking cannot be cancelled');
    return this.getForTutor(tutorId, bookingId);
  }
}

/** Internal signal: a parallel request with the same Idempotency-Key already created the booking. */
export class IdempotentReplay {
  constructor(readonly bookingId: string) {}
}
