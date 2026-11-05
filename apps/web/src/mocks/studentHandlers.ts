import { http, HttpResponse } from 'msw';
import type { Booking, BookingStatus, ErrorCode, PublicSlot, ReasonCode, Review } from '../api/types';
import { tutors } from './data';
import type { MockUser } from './data';

/** Student-side handlers (T8). Rules mirror the API policy in docs/openapi.yaml; the UI must not re-implement them. */
const BASE = '/api/v1';
const HOUR = 3_600_000;
const WINDOW_HOURS = 24;
const HOLD_MS = 15 * 60_000;
const MIN_LEAD_MS = HOUR;

interface Ctx {
  currentUser: () => MockUser | undefined;
  error: (status: number, code: ErrorCode, details?: Record<string, unknown>) => Response;
  /** Public slots of a tutor between two instants (shared with the public slot handler). */
  slotsFor: (tutorId: string, from: string, to: string) => PublicSlot[];
}

interface Stored {
  booking: Booking;
  studentId: string;
  gatewayDone: boolean;
}

let stored: Stored[] = [];
/** Slots that are held or booked by someone. */
let taken = new Set<string>();
let counter = 0;

/** Test controls. `webhookDelayMs` delays the effect of completing a payment so polling can be observed. */
export const mockControl = { webhookDelayMs: 0 };

export function resetStudentState(): void {
  stored = [];
  taken = new Set();
  counter = 0;
  mockControl.webhookDelayMs = 0;
}

export const isSlotTaken = (slotId: string) => taken.has(slotId);

const uuid = (prefix: string) => `${prefix}-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const iso = (ms: number) => new Date(ms).toISOString();

export function seedStudentBooking(
  studentId: string,
  opts: { status?: BookingStatus; startAt: number; rescheduleCount?: number; tutorIndex?: number; paid?: boolean; reviewed?: boolean },
): Booking {
  const tutor = tutors[opts.tutorIndex ?? 0];
  const status = opts.status ?? 'CONFIRMED';
  const id = uuid('50000000');
  const slotId = uuid('60000000');
  const paymentId = uuid('70000000');
  const booking: Booking = {
    id,
    code: `#BK-${1000 + counter}`,
    slotId,
    status,
    startAt: iso(opts.startAt),
    endAt: iso(opts.startAt + HOUR),
    priceVnd: tutor.pricePerSessionVnd,
    holdExpiresAt: status === 'PENDING_PAYMENT' ? iso(Date.now() + HOLD_MS) : null,
    rescheduleCount: opts.rescheduleCount ?? 0,
    tutor: { id: tutor.id, fullName: tutor.fullName },
    student: { id: studentId, fullName: 'Học viên' },
    payment: {
      id: paymentId,
      provider: 'mock',
      status: status === 'CONFIRMED' ? 'PAID' : 'PENDING',
      amountVnd: tutor.pricePerSessionVnd,
      paidAt: status === 'CONFIRMED' ? iso(Date.now() - HOUR) : null,
      refundedAt: null,
    },
    review: opts.reviewed ? ({ id: uuid('80000000'), bookingId: id, rating: 5, comment: 'Rất tốt', createdAt: iso(Date.now()) } as Review) : null,
  } as unknown as Booking;
  stored.push({ booking, studentId, gatewayDone: false });
  if (status === 'CONFIRMED' || status === 'PENDING_PAYMENT') taken.add(slotId);
  return booking;
}

/** Applies lazy expiry and recomputes everything derived from the clock. */
function view(row: Stored): Booking {
  const b = row.booking;
  if (b.status === 'PENDING_PAYMENT' && b.holdExpiresAt && Date.parse(b.holdExpiresAt) <= Date.now()) {
    b.status = 'EXPIRED';
    b.payment = { ...b.payment, status: 'FAILED', failureReason: 'HOLD_EXPIRED' };
    taken.delete(b.slotId as string);
  }
  const now = Date.now();
  const start = Date.parse(b.startAt);
  const confirmed = b.status === 'CONFIRMED';
  const inWindow = start - now >= WINDOW_HOURS * HOUR;
  const finished = confirmed && Date.parse(b.endAt) <= now;
  const flag = (allowed: boolean, reasonCode?: ReasonCode) => ({ allowed, ...(allowed ? {} : { reasonCode }) });
  const common = !confirmed ? 'NOT_CONFIRMED' : start <= now ? 'SESSION_STARTED' : !inWindow ? 'WINDOW_PASSED' : null;
  b.isFinished = finished;
  b.cancelDeadline = iso(start - WINDOW_HOURS * HOUR);
  b.actions = {
    cancel: b.status === 'PENDING_PAYMENT' ? { allowed: true } : flag(common === null, common ?? undefined),
    reschedule: flag(common === null && b.rescheduleCount === 0, common ?? (b.rescheduleCount > 0 ? 'RESCHEDULE_LIMIT' : undefined)),
    review: flag(finished && !b.review, !confirmed ? 'NOT_CONFIRMED' : b.review ? 'ALREADY_REVIEWED' : !finished ? 'NOT_FINISHED' : undefined),
  };
  return { ...b, serverTime: iso(now) };
}

export function studentHandlers({ currentUser, error, slotsFor }: Ctx) {
  const asStudent = (): { user: MockUser } | { response: Response } => {
    const user = currentUser();
    if (!user) return { response: error(401, 'UNAUTHENTICATED') };
    if (user.role !== 'STUDENT') return { response: error(403, 'FORBIDDEN') };
    return { user };
  };
  /** Rows of other students look like missing rows (404), never 403. */
  const own = (userId: string, id: unknown) => stored.find((r) => r.booking.id === id && r.studentId === userId);
  const ownByPayment = (userId: string, id: unknown) => stored.find((r) => r.booking.payment.id === id && r.studentId === userId);

  const findSlot = (slotId: string) => {
    const from = new Date().toISOString();
    const to = iso(Date.now() + 60 * 24 * HOUR);
    for (const t of tutors) {
      const slot = slotsFor(t.id, from, to).find((s) => s.id === slotId);
      if (slot) return { tutor: t, slot };
    }
    return undefined;
  };
  const overlapsStudent = (userId: string, startAt: number, ignoreId?: string) =>
    stored.find((r) => {
      if (r.studentId !== userId || r.booking.id === ignoreId) return false;
      const v = view(r);
      return (v.status === 'CONFIRMED' || v.status === 'PENDING_PAYMENT') && Date.parse(v.startAt) < startAt + HOUR && startAt < Date.parse(v.endAt);
    });

  const checkout = (b: Booking) => ({ booking: view({ booking: b, studentId: '', gatewayDone: false }), checkoutUrl: `/cong-thanh-toan-gia-lap/${b.payment.id}`, serverTime: iso(Date.now()) });

  return [
    http.get(`${BASE}/slots/:slotId`, ({ params }) => {
      const found = findSlot(String(params.slotId));
      if (!found) return error(404, 'NOT_FOUND');
      const { tutor, slot } = found;
      return HttpResponse.json({ ...slot, status: taken.has(slot.id) ? 'UNAVAILABLE' : slot.status, tutor, priceVnd: tutor.pricePerSessionVnd });
    }),

    http.post(`${BASE}/bookings`, async ({ request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const { slotId } = (await request.json()) as { slotId?: string };
      const found = slotId ? findSlot(slotId) : undefined;
      if (!found) return error(404, 'NOT_FOUND');
      const startAt = Date.parse(found.slot.startAt);
      if (taken.has(found.slot.id) || found.slot.status !== 'AVAILABLE') return error(409, 'SLOT_UNAVAILABLE');
      if (startAt < Date.now() + MIN_LEAD_MS) return error(409, 'SLOT_TOO_SOON');
      const clash = overlapsStudent(r.user.id, startAt);
      if (clash) {
        return error(409, 'STUDENT_OVERLAP', {
          conflictingBooking: { id: clash.booking.id, code: clash.booking.code, startAt: clash.booking.startAt, endAt: clash.booking.endAt, tutorName: clash.booking.tutor.fullName },
        });
      }
      const booking = seedStudentBooking(r.user.id, { status: 'PENDING_PAYMENT', startAt, tutorIndex: tutors.indexOf(found.tutor) });
      booking.slotId = found.slot.id;
      taken.delete(stored[stored.length - 1].booking.slotId as string);
      taken.add(found.slot.id);
      booking.student = { id: r.user.id, fullName: r.user.fullName };
      return HttpResponse.json(checkout(booking), { status: 201 });
    }),

    http.get(`${BASE}/bookings`, ({ request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const q = new URL(request.url).searchParams;
      const scope = q.get('scope') ?? 'upcoming';
      const now = Date.now();
      const list = stored
        .filter((x) => x.studentId === r.user.id)
        .map(view)
        .filter((b) =>
          scope === 'cancelled' ? b.status === 'EXPIRED' || b.status.startsWith('CANCELLED')
            : scope === 'past' ? b.status === 'CONFIRMED' && Date.parse(b.endAt) <= now
              : (b.status === 'CONFIRMED' && Date.parse(b.endAt) > now) || b.status === 'PENDING_PAYMENT',
        )
        .sort((a, b) => (scope === 'upcoming' ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt)));
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
      return HttpResponse.json({ page, pageSize, total: list.length, items: list.slice((page - 1) * pageSize, page * pageSize) });
    }),

    http.get(`${BASE}/bookings/:bookingId`, ({ params }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = own(r.user.id, params.bookingId);
      return row ? HttpResponse.json(view(row)) : error(404, 'NOT_FOUND');
    }),

    http.post(`${BASE}/bookings/:bookingId/checkout`, ({ params }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = own(r.user.id, params.bookingId);
      if (!row) return error(404, 'NOT_FOUND');
      if (view(row).status !== 'PENDING_PAYMENT') return error(409, 'BOOKING_NOT_PAYABLE');
      return HttpResponse.json(checkout(row.booking));
    }),

    http.post(`${BASE}/bookings/:bookingId/cancel`, async ({ params, request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = own(r.user.id, params.bookingId);
      if (!row) return error(404, 'NOT_FOUND');
      const b = view(row);
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      if (b.status === 'PENDING_PAYMENT') {
        row.booking.status = 'EXPIRED';
        row.booking.payment = { ...row.booking.payment, status: 'FAILED', failureReason: 'CANCELLED_BY_STUDENT' };
        taken.delete(b.slotId as string);
        return HttpResponse.json(view(row));
      }
      if (b.status !== 'CONFIRMED') return error(409, 'NOT_CONFIRMED');
      if (Date.parse(b.startAt) <= Date.now()) return error(409, 'SESSION_STARTED');
      if (!b.actions?.cancel.allowed) return error(409, 'WINDOW_PASSED');
      row.booking.status = 'CANCELLED_BY_STUDENT';
      row.booking.cancelledAt = iso(Date.now());
      row.booking.cancelReason = body.reason ?? null;
      row.booking.payment = { ...row.booking.payment, status: 'REFUNDED', refundedAt: iso(Date.now()) };
      taken.delete(b.slotId as string);
      return HttpResponse.json(view(row));
    }),

    http.post(`${BASE}/bookings/:bookingId/reschedule`, async ({ params, request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = own(r.user.id, params.bookingId);
      if (!row) return error(404, 'NOT_FOUND');
      const b = view(row);
      if (b.status !== 'CONFIRMED') return error(409, 'NOT_CONFIRMED');
      if (!b.actions?.cancel.allowed) return error(409, 'WINDOW_PASSED');
      if (b.rescheduleCount > 0) return error(409, 'RESCHEDULE_LIMIT');
      const { newSlotId } = (await request.json()) as { newSlotId?: string };
      const found = newSlotId ? findSlot(newSlotId) : undefined;
      if (!found || found.tutor.id !== b.tutor.id) return error(404, 'NOT_FOUND');
      if (taken.has(found.slot.id) || found.slot.status !== 'AVAILABLE') return error(409, 'SLOT_UNAVAILABLE');
      const startAt = Date.parse(found.slot.startAt);
      if (startAt < Date.now() + MIN_LEAD_MS) return error(409, 'SLOT_TOO_SOON');
      if (overlapsStudent(r.user.id, startAt, b.id)) return error(409, 'STUDENT_OVERLAP');
      taken.delete(b.slotId as string);
      taken.add(found.slot.id);
      row.booking.slotId = found.slot.id;
      row.booking.startAt = found.slot.startAt;
      row.booking.endAt = found.slot.endAt;
      row.booking.rescheduleCount = 1;
      return HttpResponse.json(view(row));
    }),

    http.post(`${BASE}/bookings/:bookingId/review`, async ({ params, request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = own(r.user.id, params.bookingId);
      if (!row) return error(404, 'NOT_FOUND');
      const b = view(row);
      const body = (await request.json()) as { rating?: number; comment?: string };
      if (!Number.isInteger(body.rating) || (body.rating as number) < 1 || (body.rating as number) > 5) {
        return error(400, 'VALIDATION_FAILED', { fields: [{ field: 'rating', code: 'too_small' }] });
      }
      if (b.status !== 'CONFIRMED') return error(409, 'NOT_CONFIRMED');
      if (!b.isFinished) return error(409, 'NOT_FINISHED');
      if (b.review) return error(409, 'ALREADY_REVIEWED');
      const review = { id: uuid('80000000'), bookingId: b.id, studentName: r.user.fullName, rating: body.rating as number, comment: body.comment ?? null, createdAt: iso(Date.now()) } as Review;
      row.booking.review = review;
      return HttpResponse.json(review, { status: 201 });
    }),

    http.get(`${BASE}/mock-gateway/payments/:paymentId`, ({ params }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = ownByPayment(r.user.id, params.paymentId);
      if (!row) return error(404, 'NOT_FOUND');
      const b = view(row);
      return HttpResponse.json({
        paymentId: b.payment.id,
        bookingId: b.id,
        bookingCode: b.code,
        amountVnd: b.payment.amountVnd,
        status: b.payment.status,
        holdExpired: b.status === 'EXPIRED',
        completable: !row.gatewayDone && (b.payment.status === 'PENDING' || (b.payment.status === 'FAILED' && b.payment.failureReason === 'HOLD_EXPIRED')),
      });
    }),

    http.post(`${BASE}/mock-gateway/payments/:paymentId/complete`, async ({ params, request }) => {
      const r = asStudent();
      if ('response' in r) return r.response;
      const row = ownByPayment(r.user.id, params.paymentId);
      if (!row) return error(404, 'NOT_FOUND');
      const b = view(row);
      const { result } = (await request.json()) as { result?: 'SUCCESS' | 'FAILURE' };
      if (row.gatewayDone) return error(409, 'GATEWAY_ALREADY_COMPLETED');
      if (b.status === 'CANCELLED_BY_STUDENT' || (b.status === 'CONFIRMED')) return error(409, 'BOOKING_NOT_PAYABLE');
      row.gatewayDone = true;
      // The API posts the signed webhook itself; the booking only changes once that lands.
      const apply = () => {
        const live = view(row);
        if (result === 'FAILURE') {
          if (live.status === 'PENDING_PAYMENT') {
            row.booking.status = 'EXPIRED';
            row.booking.payment = { ...row.booking.payment, status: 'FAILED', failureReason: 'DECLINED' };
            taken.delete(live.slotId as string);
          }
        } else if (live.status === 'PENDING_PAYMENT') {
          row.booking.status = 'CONFIRMED';
          row.booking.holdExpiresAt = null;
          row.booking.payment = { ...row.booking.payment, status: 'PAID', paidAt: iso(Date.now()) };
        } else if (live.status === 'EXPIRED') {
          // Late payment: paid, then refunded automatically; the booking stays expired.
          row.booking.payment = { ...row.booking.payment, status: 'REFUNDED', paidAt: iso(Date.now()), refundedAt: iso(Date.now()), failureReason: null };
        }
      };
      if (mockControl.webhookDelayMs > 0) setTimeout(apply, mockControl.webhookDelayMs);
      else apply();
      return HttpResponse.json({ redirectUrl: `/thanh-toan/${b.id}/ket-qua` });
    }),
  ];
}
