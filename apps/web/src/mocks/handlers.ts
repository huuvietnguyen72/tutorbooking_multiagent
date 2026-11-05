import { http, HttpResponse } from 'msw';
import type {
  BookingStatus,
  ErrorCode,
  Me,
  PublicSlot,
  TutorBooking,
  TutorOwnProfile,
  TutorProfileInput,
  TutorSlot,
  TutorSummary,
} from '../api/types';
import { dayKey } from '../lib/time';
import { reviews, subjects, tutors, users, type MockUser } from './data';

/** Handlers follow docs/openapi.yaml (servers: /api/v1). In-memory session state resets via `resetMockState`. */
const BASE = '/api/v1';

let sessionUserId: string | null = null;
let registered: MockUser[] = [];

interface TutorState {
  profile: TutorOwnProfile;
  slots: TutorSlot[];
  bookings: TutorBooking[];
}
let tutorStates = new Map<string, TutorState>();

export function resetMockState(): void {
  sessionUserId = null;
  registered = [];
  tutorStates = new Map();
  for (const u of users) {
    if (u.id === 'u-admin') u.mustChangePassword = true;
  }
}

const allUsers = () => [...users, ...registered];
const toMe = (user: MockUser): Me => {
  const me: Me = { ...user };
  delete (me as Partial<MockUser>).password;
  return me;
};
const currentUser = () => allUsers().find((u) => u.id === sessionUserId);

function error(status: number, code: ErrorCode, details?: Record<string, unknown>) {
  return HttpResponse.json({ error: { code, message: code, details } }, { status });
}

export function slotsFor(tutorId: string, from: string, to: string): PublicSlot[] {
  const index = tutors.findIndex((t) => t.id === tutorId);
  const out: PublicSlot[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (let day = new Date(start); day < end; day = new Date(day.getTime() + 86_400_000)) {
    const dow = (day.getUTCDay() + index) % 7;
    if (dow === 0 || dow === 3) continue; // some days without slots
    for (const hour of [2, 12]) {
      // 09:00 and 19:00 in GMT+7
      const startAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour));
      if (startAt < start || startAt >= end || startAt.getTime() < Date.now() + 3_600_000) continue;
      out.push({
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(4, '0')}${String(startAt.getTime()).slice(-8)}`,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
        status: (startAt.getUTCDate() + hour) % 5 === 0 ? 'UNAVAILABLE' : 'AVAILABLE',
      });
    }
  }
  return out;
}

const HOUR = 3_600_000;

function seedTutor(user: MockUser): TutorState {
  const approvalStatus = user.tutorApprovalStatus ?? 'PENDING_APPROVAL';
  const profile: TutorOwnProfile = {
    id: user.id,
    fullName: user.fullName,
    avatarUrl: null,
    subjects: [subjects[0]],
    pricePerSessionVnd: 200_000,
    ratingAvg: 4.5,
    ratingCount: 2,
    nextAvailableAt: null,
    bio: 'Giới thiệu mẫu.',
    experience: '3 năm kinh nghiệm',
    approvalStatus,
    rejectionReason: approvalStatus === 'REJECTED' ? 'Thiếu thông tin kinh nghiệm.' : null,
  };
  const now = Date.now();
  const mk = (n: number, status: BookingStatus, startAt: number, student: string, extra: Partial<TutorBooking> = {}) => ({
    id: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    code: `BK-000${n}`,
    status,
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(startAt + HOUR).toISOString(),
    priceVnd: 200_000,
    student: { fullName: student },
    actions: { cancel: { allowed: false } },
    ...extra,
  }) as TutorBooking;
  const bookings = approvalStatus === 'APPROVED' || approvalStatus === 'SUSPENDED'
    ? [
        mk(1, 'CONFIRMED', now + 72 * HOUR, 'Nguyễn A.'),
        mk(2, 'CONFIRMED', now - HOUR / 6, 'Trần B.'),
        mk(3, 'CONFIRMED', now - 72 * HOUR, 'Lê C.', { isFinished: true }),
        mk(4, 'CANCELLED_BY_STUDENT', now + 96 * HOUR, 'Phạm D.', { cancelledByRole: 'STUDENT', cancelledAt: new Date(now - HOUR).toISOString() }),
      ]
    : [];
  const slots: TutorSlot[] = bookings
    .filter((b) => b.status === 'CONFIRMED')
    .map((b) => ({ id: `40000000-0000-4000-8000-${b.id.slice(-12)}`, startAt: b.startAt, endAt: b.endAt, status: 'BOOKED' as const, booking: { id: b.id, code: b.code, studentName: b.student.fullName } }));
  return { profile, slots, bookings };
}

/** Role/ownership checks mirror the API: 401 without a session, 403 for other roles, 404 for rows that are not the caller's. */
function asTutor(): { state: TutorState; user: MockUser } | { response: Response } {
  const user = currentUser();
  if (!user) return { response: error(401, 'UNAUTHENTICATED') };
  if (user.role !== 'TUTOR') return { response: error(403, 'FORBIDDEN') };
  if (!tutorStates.has(user.id)) tutorStates.set(user.id, seedTutor(user));
  return { state: tutorStates.get(user.id) as TutorState, user };
}

const withBookingActions = (b: TutorBooking): TutorBooking => {
  const started = Date.parse(b.startAt) <= Date.now();
  const cancel =
    b.status !== 'CONFIRMED' ? { allowed: false, reasonCode: 'NOT_CONFIRMED' as const }
      : started ? { allowed: false, reasonCode: 'SESSION_STARTED' as const }
        : { allowed: true };
  return { ...b, isFinished: Date.parse(b.endAt) <= Date.now(), actions: { cancel } };
};

const overlaps = (slots: TutorSlot[], startAt: number, ignoreId?: string) =>
  slots.some((x) => x.id !== ignoreId && Date.parse(x.startAt) < startAt + HOUR && startAt < Date.parse(x.endAt));

const tutorHandlers = [
  http.get(`${BASE}/tutor/profile`, () => {
    const r = asTutor();
    return 'response' in r ? r.response : HttpResponse.json(r.state.profile);
  }),

  http.put(`${BASE}/tutor/profile`, async ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const body = (await request.json()) as TutorProfileInput;
    const fields: { field: string; code: string }[] = [];
    if (!body.fullName?.trim()) fields.push({ field: 'fullName', code: 'too_small' });
    if (!Array.isArray(body.subjectIds) || body.subjectIds.length === 0) fields.push({ field: 'subjectIds', code: 'too_small' });
    if (!Number.isInteger(body.pricePerSessionVnd) || body.pricePerSessionVnd <= 0) fields.push({ field: 'pricePerSessionVnd', code: 'too_small' });
    if (fields.length > 0) return error(400, 'VALIDATION_FAILED', { fields });
    r.state.profile = {
      ...r.state.profile,
      fullName: body.fullName,
      bio: body.bio,
      experience: body.experience,
      pricePerSessionVnd: body.pricePerSessionVnd,
      subjects: subjects.filter((x) => body.subjectIds.includes(x.id)),
    };
    return HttpResponse.json(r.state.profile);
  }),

  http.put(`${BASE}/tutor/profile/avatar`, async ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    // Raw parsing: undici's multipart parser asserts on jsdom's File class in the test environment.
    const raw = await request.text();
    const type = /name="file"[^]*?content-type:\s*([^\r\n]+)/i.exec(raw)?.[1];
    if (!type) return error(400, 'VALIDATION_FAILED');
    if (type !== 'image/png' && type !== 'image/jpeg') return error(415, 'UNSUPPORTED_FILE_TYPE');
    r.state.profile = { ...r.state.profile, avatarUrl: '/api/v1/files/avatars/mock.png' };
    return HttpResponse.json(r.state.profile);
  }),

  http.post(`${BASE}/tutor/profile/submit`, () => {
    const r = asTutor();
    if ('response' in r) return r.response;
    if (r.state.profile.approvalStatus !== 'REJECTED') return error(409, 'INVALID_STATE');
    r.state.profile = { ...r.state.profile, approvalStatus: 'PENDING_APPROVAL', rejectionReason: null };
    r.user.tutorApprovalStatus = 'PENDING_APPROVAL';
    return HttpResponse.json(r.state.profile);
  }),

  http.get(`${BASE}/tutor/slots`, ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const q = new URL(request.url).searchParams;
    const from = Date.parse(q.get('from') ?? '');
    const to = Date.parse(q.get('to') ?? '');
    if (Number.isNaN(from) || Number.isNaN(to)) return error(400, 'VALIDATION_FAILED');
    return HttpResponse.json(r.state.slots.filter((x) => Date.parse(x.startAt) >= from && Date.parse(x.startAt) < to));
  }),

  http.post(`${BASE}/tutor/slots`, async ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    if (r.state.profile.approvalStatus !== 'APPROVED') return error(403, 'TUTOR_NOT_ACCEPTING');
    const { startTimes } = (await request.json()) as { startTimes: string[] };
    const times = (startTimes ?? []).map((x) => Date.parse(x));
    if (times.length === 0 || times.some((x) => Number.isNaN(x) || x <= Date.now())) return error(400, 'VALIDATION_FAILED');
    if (times.some((x) => overlaps(r.state.slots, x))) return error(409, 'SLOT_OVERLAP');
    const created = times.map((x, i): TutorSlot => ({
      id: `40000000-0000-4000-8000-${String(Date.now() + i).padStart(12, '0').slice(-12)}`,
      startAt: new Date(x).toISOString(),
      endAt: new Date(x + HOUR).toISOString(),
      status: 'AVAILABLE',
    }));
    r.state.slots.push(...created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch(`${BASE}/tutor/slots/:slotId`, async ({ params, request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const slot = r.state.slots.find((x) => x.id === params.slotId);
    if (!slot) return error(404, 'NOT_FOUND');
    if (slot.status !== 'AVAILABLE') return error(409, 'SLOT_LOCKED');
    const startAt = Date.parse(((await request.json()) as { startAt: string }).startAt);
    if (Number.isNaN(startAt) || startAt <= Date.now()) return error(400, 'VALIDATION_FAILED');
    if (overlaps(r.state.slots, startAt, slot.id)) return error(409, 'SLOT_OVERLAP');
    slot.startAt = new Date(startAt).toISOString();
    slot.endAt = new Date(startAt + HOUR).toISOString();
    return HttpResponse.json(slot);
  }),

  http.delete(`${BASE}/tutor/slots/:slotId`, ({ params }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const slot = r.state.slots.find((x) => x.id === params.slotId);
    if (!slot) return error(404, 'NOT_FOUND');
    if (slot.status !== 'AVAILABLE' && slot.status !== 'CLOSED') return error(409, 'SLOT_LOCKED');
    r.state.slots = r.state.slots.filter((x) => x.id !== slot.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${BASE}/tutor/slots/:slotId/reopen`, ({ params }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const slot = r.state.slots.find((x) => x.id === params.slotId);
    if (!slot) return error(404, 'NOT_FOUND');
    if (slot.status !== 'CLOSED') return error(409, 'INVALID_STATE');
    if (Date.parse(slot.startAt) <= Date.now()) return error(409, 'SLOT_TOO_SOON');
    if (overlaps(r.state.slots.filter((x) => x.status !== 'CLOSED'), Date.parse(slot.startAt))) return error(409, 'SLOT_OVERLAP');
    slot.status = 'AVAILABLE';
    return HttpResponse.json(slot);
  }),

  http.get(`${BASE}/tutor/bookings`, ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const q = new URL(request.url).searchParams;
    const scope = q.get('scope') ?? 'upcoming';
    const now = Date.now();
    const list = r.state.bookings
      .map(withBookingActions)
      .filter((b) =>
        scope === 'cancelled' ? b.status.startsWith('CANCELLED')
          : b.status !== 'CONFIRMED' ? false
            : scope === 'past' ? Date.parse(b.endAt) <= now
              : Date.parse(b.endAt) > now,
      )
      .sort((a, b) => (scope === 'upcoming' ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt)));
    const page = Math.max(1, Number(q.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
    return HttpResponse.json({ page, pageSize, total: list.length, items: list.slice((page - 1) * pageSize, page * pageSize) });
  }),

  http.get(`${BASE}/tutor/bookings/:bookingId`, ({ params }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const b = r.state.bookings.find((x) => x.id === params.bookingId);
    return b ? HttpResponse.json(withBookingActions(b)) : error(404, 'NOT_FOUND');
  }),

  http.post(`${BASE}/tutor/bookings/:bookingId/cancel`, async ({ params, request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const b = r.state.bookings.find((x) => x.id === params.bookingId);
    if (!b) return error(404, 'NOT_FOUND');
    const reason = ((await request.json()) as { reason?: string }).reason?.trim();
    if (!reason) return error(400, 'VALIDATION_FAILED', { fields: [{ field: 'reason', code: 'too_small' }] });
    if (b.status !== 'CONFIRMED') return error(409, 'NOT_CONFIRMED');
    if (Date.parse(b.startAt) <= Date.now()) return error(409, 'SESSION_STARTED');
    b.status = 'CANCELLED_BY_TUTOR';
    b.cancelledByRole = 'TUTOR';
    b.cancelledAt = new Date().toISOString();
    b.tutorCancelReason = reason;
    const slot = r.state.slots.find((x) => x.booking?.id === b.id);
    if (slot) {
      slot.status = 'CLOSED';
      slot.booking = null;
    }
    return HttpResponse.json(withBookingActions(b));
  }),

  http.get(`${BASE}/tutor/reviews`, ({ request }) => {
    const r = asTutor();
    if ('response' in r) return r.response;
    const q = new URL(request.url).searchParams;
    const page = Math.max(1, Number(q.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
    const list = r.user.id === 'u-tutor-ok' ? reviews.slice(0, 2) : [];
    return HttpResponse.json({ page, pageSize, total: list.length, items: list.slice((page - 1) * pageSize, page * pageSize) });
  }),
];

export const handlers = [
  ...tutorHandlers,
  http.get(`${BASE}/config/public`, () =>
    HttpResponse.json({
      cancellationWindowHours: 24,
      holdMinutes: 15,
      slotDurationMinutes: 60,
      minBookingLeadMinutes: 60,
      timezone: 'Asia/Ho_Chi_Minh',
      mockGatewayEnabled: true,
    }),
  ),

  http.post(`${BASE}/auth/register`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string; fullName: string; role: 'STUDENT' | 'TUTOR' };
    const fields: { field: string; code: string }[] = [];
    if (!body.fullName?.trim()) fields.push({ field: 'fullName', code: 'too_small' });
    if (!body.password || body.password.length < 8) fields.push({ field: 'password', code: 'too_small' });
    if (fields.length > 0) return error(400, 'VALIDATION_FAILED', { fields });
    if (allUsers().some((u) => u.email.toLowerCase() === body.email.toLowerCase())) return error(409, 'EMAIL_TAKEN');
    const user: MockUser = {
      id: `u-new-${registered.length + 1}`,
      email: body.email,
      password: body.password,
      fullName: body.fullName,
      role: body.role,
      status: 'ACTIVE',
      ...(body.role === 'TUTOR' ? { tutorApprovalStatus: 'PENDING_APPROVAL' as const } : {}),
    };
    registered.push(user);
    return HttpResponse.json(toMe(user), { status: 201 });
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    const user = allUsers().find((u) => u.email.toLowerCase() === body.email.toLowerCase());
    if (!user || user.password !== body.password) return error(401, 'INVALID_CREDENTIALS');
    if (user.status === 'LOCKED') return error(403, 'ACCOUNT_LOCKED');
    sessionUserId = user.id;
    return HttpResponse.json(toMe(user));
  }),

  http.post(`${BASE}/auth/logout`, () => {
    if (!currentUser()) return error(401, 'UNAUTHENTICATED');
    sessionUserId = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/me`, () => {
    const user = currentUser();
    return user ? HttpResponse.json(toMe(user)) : error(401, 'UNAUTHENTICATED');
  }),

  http.post(`${BASE}/me/password`, async ({ request }) => {
    const user = currentUser();
    if (!user) return error(401, 'UNAUTHENTICATED');
    const body = (await request.json()) as { currentPassword: string; newPassword: string };
    if (body.newPassword.length < 8) return error(400, 'VALIDATION_FAILED', { fields: [{ field: 'newPassword', code: 'too_small' }] });
    if (body.currentPassword !== user.password) return error(403, 'WRONG_CURRENT_PASSWORD');
    user.password = body.newPassword;
    user.mustChangePassword = false;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/subjects`, () => HttpResponse.json(subjects)),

  http.get(`${BASE}/tutors`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const subjectId = q.get('subjectId');
    const minPrice = q.get('minPrice');
    const maxPrice = q.get('maxPrice');
    const minRating = q.get('minRating');
    const availableDate = q.get('availableDate');
    const name = q.get('q')?.toLowerCase();
    let list: TutorSummary[] = tutors.filter((t) => {
      if (subjectId && !t.subjects.some((s) => s.id === Number(subjectId))) return false;
      if (minPrice && t.pricePerSessionVnd < Number(minPrice)) return false;
      if (maxPrice && t.pricePerSessionVnd > Number(maxPrice)) return false;
      if (minRating && t.ratingAvg < Number(minRating)) return false;
      if (availableDate && !(t.nextAvailableAt && dayKey(t.nextAvailableAt) === availableDate)) return false;
      if (name && !t.fullName.toLowerCase().includes(name)) return false;
      return true;
    });
    const sort = q.get('sort') ?? 'rating_desc';
    list = [...list].sort((a, b) =>
      sort === 'price_asc' ? a.pricePerSessionVnd - b.pricePerSessionVnd
        : sort === 'price_desc' ? b.pricePerSessionVnd - a.pricePerSessionVnd
          : b.ratingAvg - a.ratingAvg,
    );
    const page = Math.max(1, Number(q.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
    return HttpResponse.json({ page, pageSize, total: list.length, items: list.slice((page - 1) * pageSize, page * pageSize) });
  }),

  http.get(`${BASE}/tutors/:tutorId`, ({ params }) => {
    const tutor = tutors.find((t) => t.id === params.tutorId);
    return tutor ? HttpResponse.json(tutor) : error(404, 'NOT_FOUND');
  }),

  http.get(`${BASE}/tutors/:tutorId/slots`, ({ params, request }) => {
    if (!tutors.some((t) => t.id === params.tutorId)) return error(404, 'NOT_FOUND');
    const q = new URL(request.url).searchParams;
    const from = q.get('from');
    const to = q.get('to');
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return error(400, 'VALIDATION_FAILED');
    return HttpResponse.json(slotsFor(String(params.tutorId), from, to));
  }),

  http.get(`${BASE}/tutors/:tutorId/reviews`, ({ params, request }) => {
    if (!tutors.some((t) => t.id === params.tutorId)) return error(404, 'NOT_FOUND');
    const q = new URL(request.url).searchParams;
    const page = Math.max(1, Number(q.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
    return HttpResponse.json({ page, pageSize, total: reviews.length, items: reviews.slice((page - 1) * pageSize, page * pageSize) });
  }),
];
