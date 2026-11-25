import { http, HttpResponse } from 'msw';
import type {
  AdminBookingDetail,
  AdminEarningItem,
  AdminEarningsRow,
  AdminTutor,
  AdminUser,
  AuditLog,
  Booking,
  BookingStatus,
  ErrorCode,
  TutorAction,
  TutorApprovalStatus,
} from '../api/types';
import { currentMonthKey } from '../lib/time';
import { subjects, type MockUser } from './data';

/** Admin API mock (docs/openapi.yaml §admin). Mirrors the API's guards: 401 → 403 for non-admins → 404 for unknown ids. */
const BASE = '/api/v1/admin';
const HOUR = 3_600_000;
const uuid = (prefix: number, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Ctx {
  currentUser: () => MockUser | undefined;
  allUsers: () => MockUser[];
}

interface State {
  users: AdminUser[];
  tutors: AdminTutor[];
  bookings: AdminBookingDetail[];
  audit: AuditLog[];
}

function error(status: number, code: ErrorCode) {
  return HttpResponse.json({ error: { code, message: code } }, { status });
}

function seed(allUsers: MockUser[]): State {
  const users: AdminUser[] = allUsers.map((u, i) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    tutorApprovalStatus: u.tutorApprovalStatus,
    createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
  }));
  const tutors: AdminTutor[] = allUsers
    .filter((u) => u.role === 'TUTOR')
    .map((u) => {
      const approvalStatus: TutorApprovalStatus = u.tutorApprovalStatus ?? 'PENDING_APPROVAL';
      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        avatarUrl: null,
        subjects: [subjects[0]],
        pricePerSessionVnd: 200_000,
        ratingAvg: 0,
        ratingCount: 0,
        nextAvailableAt: null,
        bio: 'Giới thiệu mẫu.',
        experience: '3 năm kinh nghiệm',
        approvalStatus,
        rejectionReason: approvalStatus === 'REJECTED' ? 'Thiếu thông tin kinh nghiệm.' : null,
        reviewedAt: null,
      };
    });
  const now = Date.now();
  const mk = (n: number, status: BookingStatus, startAt: number, paymentStatus: 'PAID' | 'REFUNDED' | 'FAILED', extra: Partial<AdminBookingDetail> = {}): AdminBookingDetail => ({
    id: uuid(3, n),
    code: `#BK-${1000 + n}`,
    slotId: uuid(4, n),
    status,
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(startAt + HOUR).toISOString(),
    priceVnd: 250_000,
    rescheduleCount: 0,
    tutor: { id: 'u-tutor-ok', fullName: 'Lê Hoàng Cường' },
    student: { id: 'u-student', fullName: 'Nguyễn A' },
    studentEmail: 'hocvien@example.test',
    tutorEmail: 'giasu-duyet@example.test',
    payment: { id: uuid(5, n), provider: 'mock', status: paymentStatus, amountVnd: 250_000 },
    history: [{ fromStatus: null, toStatus: 'PENDING_PAYMENT', actorType: 'USER', createdAt: new Date(now - 100 * HOUR).toISOString() }],
    paymentEvents: [],
    createdAt: new Date(now - 100 * HOUR).toISOString(),
    ...extra,
  });
  const bookings = [
    mk(1, 'CONFIRMED', now + 72 * HOUR, 'PAID'),
    mk(2, 'CONFIRMED', now - 48 * HOUR, 'PAID', { isFinished: true }),
    mk(3, 'CANCELLED_BY_TUTOR', now + 96 * HOUR, 'PAID', {
      cancelReason: 'Gia sư bận',
      cancelledAt: new Date(now - HOUR).toISOString(),
      payment: { id: uuid(5, 3), provider: 'mock', status: 'PAID', amountVnd: 250_000, refundFailed: true },
    }),
    mk(4, 'CANCELLED_BY_STUDENT', now + 24 * HOUR, 'REFUNDED', {
      payment: { id: uuid(5, 4), provider: 'mock', status: 'REFUNDED', amountVnd: 250_000, refundedAt: new Date(now - HOUR).toISOString(), refundedByName: 'Quản trị' },
    }),
  ];
  return { users, tutors, bookings, audit: [] };
}

let state: State | null = null;

/** Earnings mock: every month has 2 tutors x 3 sessions of 200.000 ₫ (fee 10%); settled sessions are tracked per tutor and month. */
const EARNING_TUTORS = [
  { id: uuid(6, 1), name: 'Gia sư Mock A' },
  { id: uuid(6, 2), name: 'Gia sư Mock B' },
];
let settledSessions = new Map<string, Set<string>>();

export function resetAdminState(): void {
  state = null;
  settledSessions = new Map();
}

const earningItems = (tutorId: string, month: string): AdminEarningItem[] => {
  const settled = settledSessions.get(`${tutorId}|${month}`);
  return [1, 2, 3].map((n) => {
    const code = `BK-${month.replace('-', '')}-${tutorId.slice(-1)}${n}`;
    const startAt = new Date(`${month}-0${n}T03:00:00.000Z`).toISOString();
    return {
      bookingId: uuid(7, Number(tutorId.slice(-1)) * 10 + n),
      code,
      studentName: 'Học viên Mock',
      startAt,
      endAt: new Date(Date.parse(startAt) + HOUR).toISOString(),
      priceVnd: 200_000,
      platformFeeVnd: 20_000,
      netVnd: 180_000,
      settled: settled?.has(code) ?? false,
      settledAt: settled?.has(code) ? new Date().toISOString() : null,
    };
  });
};

const earningsRow = (tutor: { id: string; name: string }, month: string): AdminEarningsRow => {
  const items = earningItems(tutor.id, month);
  const settled = items.filter((i) => i.settled);
  return {
    tutorId: tutor.id,
    tutorName: tutor.name,
    sessionCount: items.length,
    grossVnd: items.length * 200_000,
    platformFeeVnd: items.length * 20_000,
    netVnd: items.length * 180_000,
    settledNetVnd: settled.length * 180_000,
    unsettledNetVnd: (items.length - settled.length) * 180_000,
    settledCount: settled.length,
    unsettledCount: items.length - settled.length,
  };
};

const page = <T,>(items: T[], q: URLSearchParams) => {
  const p = Math.max(1, Number(q.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
  return { page: p, pageSize, total: items.length, items: items.slice((p - 1) * pageSize, p * pageSize) };
};

const TRANSITIONS: Record<TutorAction, { from: TutorApprovalStatus; to: TutorApprovalStatus; audit: string }> = {
  approve: { from: 'PENDING_APPROVAL', to: 'APPROVED', audit: 'TUTOR_APPROVED' },
  reject: { from: 'PENDING_APPROVAL', to: 'REJECTED', audit: 'TUTOR_REJECTED' },
  suspend: { from: 'APPROVED', to: 'SUSPENDED', audit: 'TUTOR_SUSPENDED' },
  reinstate: { from: 'SUSPENDED', to: 'APPROVED', audit: 'TUTOR_REINSTATED' },
};

export function createAdminHandlers(ctx: Ctx) {
  const guard = (): { s: State; admin: MockUser } | { response: Response } => {
    const admin = ctx.currentUser();
    if (!admin) return { response: error(401, 'UNAUTHENTICATED') };
    if (admin.role !== 'ADMIN') return { response: error(403, 'FORBIDDEN') };
    state ??= seed(ctx.allUsers());
    return { s: state, admin };
  };
  const log = (s: State, admin: MockUser, action: string, entityType: string, entityId: string, reason?: string) =>
    s.audit.unshift({ id: s.audit.length + 1, actorId: admin.id, action, entityType, entityId, reason: reason ?? null, createdAt: new Date().toISOString() });

  return [
    http.get(`${BASE}/stats`, () => {
      const g = guard();
      if ('response' in g) return g.response;
      const { s } = g;
      return HttpResponse.json({
        pendingTutors: s.tutors.filter((t) => t.approvalStatus === 'PENDING_APPROVAL').length,
        bookingsToday: 2,
        confirmedUpcoming: s.bookings.filter((b) => b.status === 'CONFIRMED' && !b.isFinished).length,
        refundsFailed: s.bookings.filter((b) => b.payment.refundFailed).length,
      });
    }),

    http.get(`${BASE}/users`, ({ request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      const text = q.get('q')?.toLowerCase();
      const list = g.s.users.filter(
        (u) =>
          (!q.get('role') || u.role === q.get('role')) &&
          (!q.get('status') || u.status === q.get('status')) &&
          (!text || u.email?.toLowerCase().includes(text) || u.fullName?.toLowerCase().includes(text)),
      );
      return HttpResponse.json(page(list, q));
    }),

    http.patch(`${BASE}/users/:userId/status`, async ({ params, request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const user = g.s.users.find((u) => u.id === params.userId);
      if (!user) return error(404, 'NOT_FOUND');
      if (user.role === 'ADMIN') return error(409, 'CANNOT_LOCK_ADMIN');
      const body = (await request.json()) as { status: 'ACTIVE' | 'LOCKED'; reason?: string };
      user.status = body.status;
      log(g.s, g.admin, body.status === 'LOCKED' ? 'USER_LOCKED' : 'USER_UNLOCKED', 'user', user.id as string, body.reason);
      return HttpResponse.json(user);
    }),

    http.get(`${BASE}/tutors`, ({ request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      const text = q.get('q')?.toLowerCase();
      const list = g.s.tutors.filter(
        (t) =>
          (!q.get('approvalStatus') || t.approvalStatus === q.get('approvalStatus')) &&
          (!text || t.email?.toLowerCase().includes(text) || t.fullName.toLowerCase().includes(text)),
      );
      return HttpResponse.json(page(list, q));
    }),

    http.post(`${BASE}/tutors/:tutorId/:action`, async ({ params, request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const rule = TRANSITIONS[params.action as TutorAction];
      if (!rule) return error(400, 'VALIDATION_FAILED');
      const tutor = g.s.tutors.find((t) => t.id === params.tutorId);
      if (!tutor) return error(404, 'NOT_FOUND');
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      if (params.action === 'reject' && !body.reason) return error(400, 'VALIDATION_FAILED');
      if (tutor.approvalStatus !== rule.from) return error(409, 'INVALID_STATE');
      tutor.approvalStatus = rule.to;
      tutor.rejectionReason = params.action === 'reject' ? (body.reason ?? null) : null;
      tutor.reviewedAt = new Date().toISOString();
      const user = g.s.users.find((u) => u.id === tutor.id);
      if (user) user.tutorApprovalStatus = rule.to;
      log(g.s, g.admin, rule.audit, 'tutor', tutor.id, body.reason);
      return HttpResponse.json(tutor);
    }),

    http.get(`${BASE}/bookings`, ({ request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      const from = q.get('from');
      const to = q.get('to');
      const list: Booking[] = g.s.bookings.filter(
        (b) =>
          (!q.get('status') || b.status === q.get('status')) &&
          (!q.get('tutorId') || b.tutor.id === q.get('tutorId')) &&
          (!q.get('studentId') || b.student.id === q.get('studentId')) &&
          (!q.get('refundFailed') || b.payment.refundFailed) &&
          (!from || Date.parse(b.startAt) >= Date.parse(from)) &&
          (!to || Date.parse(b.startAt) < Date.parse(to)),
      );
      return HttpResponse.json(page(list, q));
    }),

    http.get(`${BASE}/bookings/:bookingId`, ({ params }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const b = g.s.bookings.find((x) => x.id === params.bookingId);
      return b ? HttpResponse.json(b) : error(404, 'NOT_FOUND');
    }),

    http.post(`${BASE}/bookings/:bookingId/cancel`, async ({ params, request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const b = g.s.bookings.find((x) => x.id === params.bookingId);
      if (!b) return error(404, 'NOT_FOUND');
      const body = (await request.json()) as { reason: string; refund?: boolean };
      if (!body.reason) return error(400, 'VALIDATION_FAILED');
      if (b.status !== 'CONFIRMED') return error(409, 'NOT_CONFIRMED');
      if (Date.parse(b.startAt) <= Date.now()) return error(409, 'SESSION_STARTED');
      b.status = 'CANCELLED_BY_ADMIN';
      b.cancelReason = body.reason;
      b.cancelledAt = new Date().toISOString();
      if (body.refund !== false) {
        b.payment = { ...b.payment, status: 'REFUNDED', refundedAt: b.cancelledAt, refundedByName: g.admin.fullName };
      }
      log(g.s, g.admin, 'BOOKING_CANCELLED_BY_ADMIN', 'booking', b.id, body.reason);
      return HttpResponse.json(b);
    }),

    http.post(`${BASE}/payments/:paymentId/refund`, async ({ params, request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const b = g.s.bookings.find((x) => x.payment.id === params.paymentId);
      if (!b) return error(404, 'NOT_FOUND');
      const body = (await request.json()) as { reason: string };
      if (!body.reason) return error(400, 'VALIDATION_FAILED');
      if (b.payment.status === 'REFUNDED') return error(409, 'ALREADY_REFUNDED');
      if (b.payment.status !== 'PAID') return error(409, 'PAYMENT_NOT_REFUNDABLE');
      b.payment = { ...b.payment, status: 'REFUNDED', refundFailed: false, refundedAt: new Date().toISOString(), refundedByName: g.admin.fullName };
      log(g.s, g.admin, 'PAYMENT_REFUNDED', 'payment', b.payment.id, body.reason);
      return HttpResponse.json(b.payment);
    }),

    http.get(`${BASE}/earnings`, ({ request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      const month = q.get('month') ?? currentMonthKey();
      return HttpResponse.json({ month, monthClosed: month < currentMonthKey(), ...page(EARNING_TUTORS.map((t) => earningsRow(t, month)), q) });
    }),

    http.get(`${BASE}/tutors/:tutorId/earnings/items`, ({ params, request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      if (!EARNING_TUTORS.some((t) => t.id === params.tutorId)) return error(404, 'NOT_FOUND');
      return HttpResponse.json({ month: q.get('month'), ...page(earningItems(String(params.tutorId), q.get('month') ?? currentMonthKey()), q) });
    }),

    http.put(`${BASE}/tutors/:tutorId/earnings/:month/settlement`, ({ params }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const tutorId = String(params.tutorId);
      const month = String(params.month);
      if (!EARNING_TUTORS.some((t) => t.id === tutorId)) return error(404, 'NOT_FOUND');
      if (month >= currentMonthKey()) return error(409, 'INVALID_STATE');
      const items = earningItems(tutorId, month);
      const fresh = items.filter((i) => !i.settled);
      const set = settledSessions.get(`${tutorId}|${month}`) ?? new Set<string>();
      fresh.forEach((i) => set.add(i.code));
      settledSessions.set(`${tutorId}|${month}`, set);
      if (fresh.length > 0) log(g.s, g.admin, 'EARNINGS_SETTLED', 'tutor', tutorId, month);
      return HttpResponse.json({ tutorId, month, settledCount: fresh.length, alreadySettledCount: items.length - fresh.length, settledNetVnd: fresh.length * 180_000 });
    }),

    http.get(`${BASE}/audit-logs`, ({ request }) => {
      const g = guard();
      if ('response' in g) return g.response;
      const q = new URL(request.url).searchParams;
      const list = g.s.audit.filter(
        (a) => (!q.get('entityType') || a.entityType === q.get('entityType')) && (!q.get('entityId') || a.entityId === q.get('entityId')),
      );
      return HttpResponse.json(page(list, q));
    }),
  ];
}
