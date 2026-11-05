import type { Booking, Payment, Review } from '@prisma/client';
import { z } from 'zod';
import { formatBookingCode } from './booking-code';
import {
  cancelDeadline,
  cancellationPolicy,
  Decision,
  isFinished,
  PolicyConfig,
  reschedulePolicy,
  reviewPolicy,
} from './booking.policy';

// ---- input (D4) ----
const intParam = z.coerce.number().int();

export const listBookingsSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'cancelled']).default('upcoming'),
  page: intParam.min(1).max(100_000).default(1),
  pageSize: intParam.min(1).max(100).default(20),
});

export const createBookingSchema = z.object({ slotId: z.uuid() }).strict();

export const studentCancelSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();

export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);

// ---- output: role-specific allow-lists (A1). Never `return entity`. ----
interface ActionFlagDto {
  allowed: boolean;
  reasonCode: string | null;
}

const flag = (decision: Decision<unknown>): ActionFlagDto =>
  decision.allowed ? { allowed: true, reasonCode: null } : { allowed: false, reasonCode: decision.code };

export interface PaymentDto {
  id: string;
  provider: string;
  status: string;
  failureReason: string | null;
  amountVnd: number;
  paidAt: string | null;
  refundedAt: string | null;
  refundFailed: boolean;
}

export interface StudentBookingDto {
  id: string;
  code: string;
  slotId: string;
  status: string;
  startAt: string;
  endAt: string;
  priceVnd: number;
  holdExpiresAt: string | null;
  rescheduleCount: number;
  tutor: { id: string; fullName: string };
  student: { id: string; fullName: string };
  payment: PaymentDto;
  cancelReason: string | null;
  cancelledAt: string | null;
  cancelDeadline: string;
  isFinished: boolean;
  actions: { cancel: ActionFlagDto; reschedule: ActionFlagDto; review: ActionFlagDto };
  review: { id: string; bookingId: string; rating: number; comment: string | null; hidden: boolean; createdAt: string } | null;
  serverTime?: string;
  createdAt: string;
}

export interface TutorBookingDto {
  id: string;
  code: string;
  status: string;
  startAt: string;
  endAt: string;
  priceVnd: number;
  student: { fullName: string };
  isFinished: boolean;
  cancelledAt: string | null;
  cancelledByRole: 'STUDENT' | 'TUTOR' | 'ADMIN' | null;
  tutorCancelReason: string | null;
  actions: { cancel: ActionFlagDto };
}

export type StudentBookingRow = Booking & {
  payment: Payment | null;
  tutor: { id: string; fullName: string };
  student: { id: string; fullName: string };
  review?: Review | null;
};

export const studentBookingInclude = {
  payment: true,
  tutor: { select: { id: true, fullName: true } },
  student: { select: { id: true, fullName: true } },
  review: true,
} as const;

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toPaymentDto(payment: Payment): PaymentDto {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    failureReason: payment.failureReason,
    amountVnd: payment.amountVnd,
    paidAt: iso(payment.paidAt),
    refundedAt: iso(payment.refundedAt),
    refundFailed: payment.refundFailed,
  };
}

export function toStudentBooking(
  booking: StudentBookingRow,
  now: Date,
  cfg: PolicyConfig,
  withServerTime = false,
): StudentBookingDto {
  const review = booking.review ?? null;
  return {
    id: booking.id,
    code: formatBookingCode(booking.code),
    slotId: booking.slotId,
    status: booking.status,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    priceVnd: booking.priceVnd,
    holdExpiresAt: iso(booking.holdExpiresAt),
    rescheduleCount: booking.rescheduleCount,
    tutor: { id: booking.tutor.id, fullName: booking.tutor.fullName },
    student: { id: booking.student.id, fullName: booking.student.fullName },
    payment: toPaymentDto(booking.payment!),
    cancelReason: booking.cancelReason,
    cancelledAt: iso(booking.cancelledAt),
    cancelDeadline: cancelDeadline(booking, cfg).toISOString(),
    isFinished: isFinished(booking, now),
    actions: {
      cancel: flag(cancellationPolicy(booking, 'STUDENT', now, cfg)),
      reschedule: flag(reschedulePolicy(booking, now, cfg)),
      review: flag(reviewPolicy(booking, now, review !== null)),
    },
    review: review
      ? {
          id: review.id,
          bookingId: review.bookingId,
          rating: review.rating,
          comment: review.comment,
          hidden: review.isHidden,
          createdAt: review.createdAt.toISOString(),
        }
      : null,
    ...(withServerTime ? { serverTime: now.toISOString() } : {}),
    createdAt: booking.createdAt.toISOString(),
  };
}

const CANCEL_ROLE = {
  CANCELLED_BY_STUDENT: 'STUDENT',
  CANCELLED_BY_TUTOR: 'TUTOR',
  CANCELLED_BY_ADMIN: 'ADMIN',
} as const;

/** Tutor sees the student's name, time, price and status; no payment, hold, email or the student's reason. */
export function toTutorBooking(
  booking: Booking & { student: { fullName: string } },
  now: Date,
  cfg: PolicyConfig,
): TutorBookingDto {
  const cancelledByRole = CANCEL_ROLE[booking.status as keyof typeof CANCEL_ROLE] ?? null;
  return {
    id: booking.id,
    code: formatBookingCode(booking.code),
    status: booking.status,
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    priceVnd: booking.priceVnd,
    student: { fullName: booking.student.fullName },
    isFinished: isFinished(booking, now),
    cancelledAt: iso(booking.cancelledAt),
    cancelledByRole,
    tutorCancelReason: cancelledByRole === 'TUTOR' ? booking.cancelReason : null,
    actions: { cancel: flag(cancellationPolicy(booking, 'TUTOR', now, cfg)) },
  };
}
