import {
  cancelDeadline,
  cancellationPolicy,
  isFinished,
  isHoldExpired,
  PolicyBooking,
  reschedulePolicy,
  reviewPolicy,
} from './booking.policy';

const cfg = { cancellationWindowHours: 24 };
const HOUR = 3_600_000;
const start = new Date('2026-12-10T02:00:00Z');
const booking = (over: Partial<PolicyBooking> = {}): PolicyBooking => ({
  status: 'CONFIRMED',
  startAt: start,
  endAt: new Date(start.getTime() + HOUR),
  rescheduleCount: 0,
  holdExpiresAt: null,
  ...over,
});
const at = (offsetMs: number) => new Date(start.getTime() + offsetMs);

describe('cancellationPolicy', () => {
  describe('student, CONFIRMED (24h window boundary)', () => {
    it('allows with refund exactly 24h before start', () => {
      expect(cancellationPolicy(booking(), 'STUDENT', at(-24 * HOUR), cfg)).toEqual({
        allowed: true,
        effect: 'CANCEL_AND_REFUND',
      });
    });

    it('allows far ahead of the window', () => {
      expect(cancellationPolicy(booking(), 'STUDENT', at(-24 * HOUR - 1), cfg).allowed).toBe(true);
      expect(cancellationPolicy(booking(), 'STUDENT', at(-30 * 24 * HOUR), cfg).allowed).toBe(true);
    });

    it('denies WINDOW_PASSED at 24h minus 1 second and 1 millisecond', () => {
      expect(cancellationPolicy(booking(), 'STUDENT', at(-24 * HOUR + 1000), cfg)).toEqual({
        allowed: false,
        code: 'WINDOW_PASSED',
      });
      expect(cancellationPolicy(booking(), 'STUDENT', at(-24 * HOUR + 1), cfg)).toEqual({
        allowed: false,
        code: 'WINDOW_PASSED',
      });
    });

    it('denies WINDOW_PASSED just before the session and SESSION_STARTED from startAt on', () => {
      expect(cancellationPolicy(booking(), 'STUDENT', at(-1), cfg)).toEqual({ allowed: false, code: 'WINDOW_PASSED' });
      expect(cancellationPolicy(booking(), 'STUDENT', at(0), cfg)).toEqual({ allowed: false, code: 'SESSION_STARTED' });
      expect(cancellationPolicy(booking(), 'STUDENT', at(HOUR), cfg)).toEqual({ allowed: false, code: 'SESSION_STARTED' });
    });

    it('follows the configured window', () => {
      const wide = { cancellationWindowHours: 48 };
      expect(cancellationPolicy(booking(), 'STUDENT', at(-47 * HOUR), wide).allowed).toBe(false);
      expect(cancellationPolicy(booking(), 'STUDENT', at(-48 * HOUR), wide).allowed).toBe(true);
    });
  });

  describe('student, other statuses', () => {
    const now = at(-48 * HOUR);

    it('PENDING_PAYMENT within hold: allowed without refund (hold released)', () => {
      const b = booking({ status: 'PENDING_PAYMENT', holdExpiresAt: new Date(now.getTime() + 60_000) });
      expect(cancellationPolicy(b, 'STUDENT', now, cfg)).toEqual({ allowed: true, effect: 'RELEASE_HOLD' });
    });

    it('PENDING_PAYMENT is cancellable regardless of the 24h window', () => {
      const late = at(-HOUR);
      const b = booking({ status: 'PENDING_PAYMENT', holdExpiresAt: new Date(late.getTime() + 60_000) });
      expect(cancellationPolicy(b, 'STUDENT', late, cfg).allowed).toBe(true);
    });

    it('PENDING_PAYMENT past its hold is treated as expired', () => {
      const b = booking({ status: 'PENDING_PAYMENT', holdExpiresAt: new Date(now.getTime() - 1) });
      expect(cancellationPolicy(b, 'STUDENT', now, cfg)).toEqual({ allowed: false, code: 'NOT_CONFIRMED' });
    });

    it.each(['EXPIRED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'] as const)(
      '%s is not cancellable',
      (status) => {
        expect(cancellationPolicy(booking({ status }), 'STUDENT', now, cfg)).toEqual({
          allowed: false,
          code: 'NOT_CONFIRMED',
        });
      },
    );
  });

  describe('tutor', () => {
    it('may cancel at any moment before the session, including inside the 24h window', () => {
      for (const offset of [-30 * 24 * HOUR, -24 * HOUR, -24 * HOUR + 1000, -HOUR, -1]) {
        expect(cancellationPolicy(booking(), 'TUTOR', at(offset), cfg)).toEqual({
          allowed: true,
          effect: 'CANCEL_AND_REFUND',
        });
      }
    });

    it('cannot cancel once the session started', () => {
      expect(cancellationPolicy(booking(), 'TUTOR', at(0), cfg)).toEqual({ allowed: false, code: 'SESSION_STARTED' });
    });

    it('cannot cancel unconfirmed or already cancelled bookings (no PENDING_PAYMENT shortcut)', () => {
      const pending = booking({ status: 'PENDING_PAYMENT', holdExpiresAt: at(-HOUR) });
      expect(cancellationPolicy(pending, 'TUTOR', at(-2 * HOUR), cfg)).toEqual({ allowed: false, code: 'NOT_CONFIRMED' });
      expect(cancellationPolicy(booking({ status: 'CANCELLED_BY_TUTOR' }), 'TUTOR', at(-48 * HOUR), cfg).allowed).toBe(false);
    });
  });
});

describe('isHoldExpired (15-minute hold with a fake clock)', () => {
  const created = new Date('2026-12-01T00:00:00Z');
  const hold = booking({ status: 'PENDING_PAYMENT', holdExpiresAt: new Date(created.getTime() + 15 * 60_000) });

  it('is still valid 1 ms before the deadline', () => {
    expect(isHoldExpired(hold, new Date(created.getTime() + 15 * 60_000 - 1))).toBe(false);
  });

  it('is expired exactly at hold_expires_at and after', () => {
    expect(isHoldExpired(hold, new Date(created.getTime() + 15 * 60_000))).toBe(true);
    expect(isHoldExpired(hold, new Date(created.getTime() + 16 * 60_000))).toBe(true);
  });

  it('only applies to PENDING_PAYMENT', () => {
    expect(isHoldExpired({ status: 'CONFIRMED', holdExpiresAt: new Date(0) }, created)).toBe(false);
    expect(isHoldExpired({ status: 'PENDING_PAYMENT', holdExpiresAt: null }, created)).toBe(false);
  });
});

describe('cancelDeadline', () => {
  it('is startAt minus the window', () => {
    expect(cancelDeadline(booking(), cfg).toISOString()).toBe('2026-12-09T02:00:00.000Z');
  });
});

describe('reschedulePolicy', () => {
  it('allows at the boundary, once', () => {
    expect(reschedulePolicy(booking(), at(-24 * HOUR), cfg)).toEqual({ allowed: true });
    expect(reschedulePolicy(booking(), at(-24 * HOUR + 1000), cfg)).toEqual({ allowed: false, code: 'WINDOW_PASSED' });
    expect(reschedulePolicy(booking({ rescheduleCount: 1 }), at(-48 * HOUR), cfg)).toEqual({
      allowed: false,
      code: 'RESCHEDULE_LIMIT',
    });
    expect(reschedulePolicy(booking({ status: 'EXPIRED' }), at(-48 * HOUR), cfg)).toEqual({
      allowed: false,
      code: 'NOT_CONFIRMED',
    });
  });
});

describe('reviewPolicy / isFinished', () => {
  it('requires a finished CONFIRMED booking without a review', () => {
    const end = booking().endAt;
    expect(reviewPolicy(booking(), new Date(end.getTime() - 1), false)).toEqual({ allowed: false, code: 'NOT_FINISHED' });
    expect(reviewPolicy(booking(), end, false)).toEqual({ allowed: true });
    expect(reviewPolicy(booking(), end, true)).toEqual({ allowed: false, code: 'ALREADY_REVIEWED' });
    expect(reviewPolicy(booking({ status: 'CANCELLED_BY_TUTOR' }), end, false)).toEqual({
      allowed: false,
      code: 'NOT_CONFIRMED',
    });
  });

  it('isFinished is CONFIRMED and endAt <= now', () => {
    const end = booking().endAt;
    expect(isFinished(booking(), new Date(end.getTime() - 1))).toBe(false);
    expect(isFinished(booking(), end)).toBe(true);
    expect(isFinished(booking({ status: 'EXPIRED' }), end)).toBe(false);
  });
});
