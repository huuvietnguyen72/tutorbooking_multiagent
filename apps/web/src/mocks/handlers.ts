import { http, HttpResponse } from 'msw';
import type { ErrorCode, Me, PublicSlot, TutorSummary } from '../api/types';
import { dayKey } from '../lib/time';
import { reviews, subjects, tutors, users, type MockUser } from './data';

/** Handlers follow docs/openapi.yaml (servers: /api/v1). In-memory session state resets via `resetMockState`. */
const BASE = '/api/v1';

let sessionUserId: string | null = null;
let registered: MockUser[] = [];

export function resetMockState(): void {
  sessionUserId = null;
  registered = [];
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

export const handlers = [
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
