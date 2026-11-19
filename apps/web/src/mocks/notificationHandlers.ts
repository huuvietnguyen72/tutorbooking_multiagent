import { http, HttpResponse } from 'msw';
import type { AppNotification, ErrorCode } from '../api/types';
import type { MockUser } from './data';

/** In-app notification handlers; rules follow the /notifications section of docs/openapi.yaml. */
const BASE = '/api/v1';

interface Ctx {
  currentUser: () => MockUser | undefined;
  error: (status: number, code: ErrorCode, details?: Record<string, unknown>) => Response;
}

let stored = new Map<string, AppNotification[]>();
let counter = 0;

export function resetNotificationState(): void {
  stored = new Map();
  counter = 0;
}

/** Test/demo helper: add a notification for a user (newest first, like the API). */
export function seedNotification(userId: string, partial: Partial<AppNotification> & Pick<AppNotification, 'title'>): AppNotification {
  counter += 1;
  const n: AppNotification = {
    id: `n-${counter}`,
    type: 'BOOKING_CONFIRMED',
    body: 'Nội dung thông báo',
    bookingId: null,
    isRead: false,
    readAt: null,
    createdAt: new Date(Date.now() - counter * 60_000).toISOString(),
    ...partial,
  };
  stored.set(userId, [...(stored.get(userId) ?? []), n]);
  return n;
}

export function notificationHandlers({ currentUser, error }: Ctx) {
  const mine = (user: MockUser) => stored.get(user.id) ?? [];
  return [
    http.get(`${BASE}/notifications`, ({ request }) => {
      const user = currentUser();
      if (!user) return error(401, 'UNAUTHENTICATED');
      const q = new URL(request.url).searchParams;
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
      const rows = mine(user).filter((n) => q.get('unreadOnly') !== 'true' || !n.isRead);
      return HttpResponse.json({ page, pageSize, total: rows.length, items: rows.slice((page - 1) * pageSize, page * pageSize) });
    }),
    http.get(`${BASE}/notifications/unread-count`, () => {
      const user = currentUser();
      if (!user) return error(401, 'UNAUTHENTICATED');
      return HttpResponse.json({ count: mine(user).filter((n) => !n.isRead).length });
    }),
    http.post(`${BASE}/notifications/read-all`, () => {
      const user = currentUser();
      if (!user) return error(401, 'UNAUTHENTICATED');
      const unread = mine(user).filter((n) => !n.isRead);
      for (const n of unread) Object.assign(n, { isRead: true, readAt: new Date().toISOString() });
      return HttpResponse.json({ updated: unread.length });
    }),
    http.post(`${BASE}/notifications/:id/read`, ({ params }) => {
      const user = currentUser();
      if (!user) return error(401, 'UNAUTHENTICATED');
      const n = mine(user).find((row) => row.id === params.id);
      if (!n) return error(404, 'NOT_FOUND');
      if (!n.isRead) Object.assign(n, { isRead: true, readAt: new Date().toISOString() });
      return HttpResponse.json(n);
    }),
  ];
}
