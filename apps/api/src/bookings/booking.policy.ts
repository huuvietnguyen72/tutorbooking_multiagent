import type { BookingStatus } from '@prisma/client';

/** Reason codes the UI maps to text; same set as `ReasonCode` in docs/openapi.yaml. */
export type ReasonCode =
  | 'WINDOW_PASSED'
  | 'RESCHEDULE_LIMIT'
  | 'NOT_CONFIRMED'
  | 'SESSION_STARTED'
  | 'NOT_FINISHED'
  | 'ALREADY_REVIEWED';

export interface PolicyBooking {
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  rescheduleCount: number;
  holdExpiresAt: Date | null;
}

export interface PolicyConfig {
  cancellationWindowHours: number;
}

/** What a permitted cancel does to money and slot (§2.5). */
export type CancelEffect = 'RELEASE_HOLD' | 'CANCEL_AND_REFUND';

export type Decision<E = never> = { allowed: true; effect?: E } | { allowed: false; code: ReasonCode };

const HOUR_MS = 3_600_000;

/** `PENDING_PAYMENT` whose hold ran out counts as expired even before the job flips it (§2.3). */
export function isHoldExpired(booking: Pick<PolicyBooking, 'status' | 'holdExpiresAt'>, now: Date): boolean {
  return (
    booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt !== null && booking.holdExpiresAt.getTime() <= now.getTime()
  );
}

export const cancelDeadline = (booking: Pick<PolicyBooking, 'startAt'>, cfg: PolicyConfig): Date =>
  new Date(booking.startAt.getTime() - cfg.cancellationWindowHours * HOUR_MS);

/**
 * Student: PENDING_PAYMENT may always be dropped; CONFIRMED only while `startAt - now >= window`
 * (exactly 24h is still allowed, 24h - 1s is not). Tutor and admin: any time before the session starts.
 */
export function cancellationPolicy(
  booking: PolicyBooking,
  actor: 'STUDENT' | 'TUTOR' | 'ADMIN',
  now: Date,
  cfg: PolicyConfig,
): Decision<CancelEffect> {
  if (actor === 'STUDENT' && booking.status === 'PENDING_PAYMENT' && !isHoldExpired(booking, now)) {
    return { allowed: true, effect: 'RELEASE_HOLD' };
  }
  if (booking.status !== 'CONFIRMED') return { allowed: false, code: 'NOT_CONFIRMED' };
  if (now.getTime() >= booking.startAt.getTime()) return { allowed: false, code: 'SESSION_STARTED' };
  if (actor === 'STUDENT' && booking.startAt.getTime() - now.getTime() < cfg.cancellationWindowHours * HOUR_MS) {
    return { allowed: false, code: 'WINDOW_PASSED' };
  }
  return { allowed: true, effect: 'CANCEL_AND_REFUND' };
}

/** Same window as cancel, once only. */
export function reschedulePolicy(booking: PolicyBooking, now: Date, cfg: PolicyConfig): Decision {
  if (booking.status !== 'CONFIRMED') return { allowed: false, code: 'NOT_CONFIRMED' };
  if (now.getTime() >= booking.startAt.getTime()) return { allowed: false, code: 'SESSION_STARTED' };
  if (booking.startAt.getTime() - now.getTime() < cfg.cancellationWindowHours * HOUR_MS) {
    return { allowed: false, code: 'WINDOW_PASSED' };
  }
  if (booking.rescheduleCount >= 1) return { allowed: false, code: 'RESCHEDULE_LIMIT' };
  return { allowed: true };
}

export function reviewPolicy(booking: PolicyBooking, now: Date, hasReview: boolean): Decision {
  if (booking.status !== 'CONFIRMED') return { allowed: false, code: 'NOT_CONFIRMED' };
  if (booking.endAt.getTime() > now.getTime()) return { allowed: false, code: 'NOT_FINISHED' };
  if (hasReview) return { allowed: false, code: 'ALREADY_REVIEWED' };
  return { allowed: true };
}

export const isFinished = (booking: Pick<PolicyBooking, 'status' | 'endAt'>, now: Date): boolean =>
  booking.status === 'CONFIRMED' && booking.endAt.getTime() <= now.getTime();
