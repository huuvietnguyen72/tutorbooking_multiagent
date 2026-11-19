import { http, HttpResponse } from 'msw';
import type { ErrorCode, TutorEarningCancelled, TutorEarningItem, TutorEarningAdjustment } from '../api/types';
import { monthKey } from '../lib/time';
import type { MockUser } from './data';

const BASE = '/api/v1';
const FEE_RATE = 0.1;
const HOUR = 3_600_000;

interface Deps {
  currentUser: () => MockUser | null | undefined;
  error: (status: number, code: ErrorCode, details?: Record<string, unknown>) => Response;
}

const BOOKING_ID = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fixed sample data for the current month; every other month is empty. */
function sampleItems(): TutorEarningItem[] {
  const base = Date.now() - 72 * HOUR;
  const mk = (n: number, student: string, price: number, settled: boolean): TutorEarningItem => {
    const startAt = base - n * 24 * HOUR;
    const fee = Math.round(price * FEE_RATE);
    return {
      bookingId: BOOKING_ID(n),
      code: `BK-${String(9000 + n)}`,
      studentName: student,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(startAt + HOUR).toISOString(),
      priceVnd: price,
      platformFeeVnd: fee,
      netVnd: price - fee,
      settled,
      settledAt: settled ? new Date(startAt + 24 * HOUR).toISOString() : null,
    };
  };
  return [mk(1, 'Nguyễn A.', 200_000, true), mk(2, 'Trần B.', 150_000, false), mk(3, 'Lê C.', 333_333, false)];
}

export function earningsHandlers({ currentUser, error }: Deps) {
  const guard = (): Response | null => {
    const user = currentUser();
    if (!user) return error(401, 'UNAUTHENTICATED');
    if (user.role !== 'TUTOR') return error(403, 'FORBIDDEN');
    return null;
  };
  const items = (month: string) => (month === monthKey() ? sampleItems() : []);

  return [
    http.get(`${BASE}/tutor/earnings`, ({ request }) => {
      const denied = guard();
      if (denied) return denied;
      const month = new URL(request.url).searchParams.get('month') ?? monthKey();
      const rows = items(month);
      const sum = (f: (i: TutorEarningItem) => number, p: (i: TutorEarningItem) => boolean = () => true) => rows.filter(p).reduce((a, i) => a + f(i), 0);
      return HttpResponse.json({
        month,
        timezone: 'Asia/Ho_Chi_Minh',
        isEmpty: rows.length === 0,
        sessionCount: rows.length,
        grossVnd: sum((i) => i.priceVnd),
        platformFeeVnd: sum((i) => i.platformFeeVnd),
        netVnd: sum((i) => i.netVnd),
        settledNetVnd: sum((i) => i.netVnd, (i) => i.settled),
        unsettledNetVnd: sum((i) => i.netVnd, (i) => !i.settled),
        feeRate: FEE_RATE,
        adjustmentsVnd: 0,
        adjustmentCount: 0,
      });
    }),

    http.get(`${BASE}/tutor/earnings/items`, ({ request }) => {
      const denied = guard();
      if (denied) return denied;
      const q = new URL(request.url).searchParams;
      const month = q.get('month') ?? monthKey();
      const settlement = q.get('settlement') ?? 'all';
      const page = Math.max(1, Number(q.get('page') ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)));
      const dir = q.get('sort') === 'startAt:asc' ? 1 : -1;
      const list = items(month)
        .filter((i) => settlement === 'all' || (settlement === 'settled') === i.settled)
        .sort((a, b) => dir * a.startAt.localeCompare(b.startAt));
      const empty = month !== monthKey();
      const startAt = new Date(Date.now() - 10 * 24 * HOUR).toISOString();
      const cancelled: TutorEarningCancelled[] = empty ? [] : [{
        bookingId: BOOKING_ID(20), code: 'BK-9020', studentName: 'Phạm D.', startAt, endAt: startAt,
        priceVnd: 200_000, status: 'CANCELLED_BY_TUTOR', refunded: true, cancelledByRole: 'TUTOR', tutorCancelReason: 'Bận việc đột xuất',
      }];
      const adjustments: TutorEarningAdjustment[] = [];
      return HttpResponse.json({ month, page, pageSize, total: list.length, items: list.slice((page - 1) * pageSize, page * pageSize), cancelled, adjustments });
    }),
  ];
}
