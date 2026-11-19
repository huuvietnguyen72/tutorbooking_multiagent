import type { TutorEarningAdjustment, TutorEarningCancelled, TutorEarningItem, TutorEarningsSummary } from '../api/types';
import { currentMonth, shiftMonth } from '../lib/time';

export const MOCK_FEE_RATE = 0.1;
const HOUR = 3_600_000;

export interface MockEarnings {
  items: TutorEarningItem[];
  cancelled: (TutorEarningCancelled & { month: string })[];
  adjustments: (TutorEarningAdjustment & { month: string })[];
}

const monthStart = (month: string) => Date.parse(`${month}-01T03:00:00+07:00`);
const uuid = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function item(n: number, month: string, day: number, student: string, price: number, settled: boolean): TutorEarningItem {
  const startAt = monthStart(month) + (day - 1) * 24 * HOUR;
  const fee = Math.round(price * MOCK_FEE_RATE);
  return {
    bookingId: uuid(n),
    code: `BK-${String(n).padStart(4, '0')}`,
    studentName: student,
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(startAt + HOUR).toISOString(),
    priceVnd: price,
    platformFeeVnd: fee,
    netVnd: price - fee,
    settled,
    settledAt: settled ? new Date(startAt + 5 * 24 * HOUR).toISOString() : null,
  };
}

/** Current month: 3 sessions (1 settled) plus a refund; previous month: 2 settled sessions and a cancelled one; older months are empty. */
export function seedEarnings(): MockEarnings {
  const now = currentMonth();
  const prev = shiftMonth(now, -1);
  const cancelledStart = monthStart(prev) + 9 * 24 * HOUR;
  return {
    items: [
      item(1, now, 1, 'Nguyễn A.', 200_000, true),
      item(2, now, 1, 'Trần B.', 150_000, false),
      item(3, now, 1, 'Lê C.', 333_333, false),
      item(4, prev, 3, 'Phạm D.', 200_000, true),
      item(5, prev, 5, 'Hoàng E.', 250_000, true),
    ],
    cancelled: [
      {
        month: prev,
        bookingId: uuid(6),
        code: 'BK-0006',
        studentName: 'Vũ F.',
        startAt: new Date(cancelledStart).toISOString(),
        endAt: new Date(cancelledStart + HOUR).toISOString(),
        priceVnd: 200_000,
        status: 'CANCELLED_BY_TUTOR',
        refunded: true,
        cancelledByRole: 'TUTOR',
        tutorCancelReason: 'Bận đột xuất',
      },
    ],
    adjustments: [
      {
        month: now,
        bookingId: uuid(4),
        code: 'BK-0004',
        studentName: 'Phạm D.',
        startAt: new Date(monthStart(prev) + 2 * 24 * HOUR).toISOString(),
        endAt: new Date(monthStart(prev) + 2 * 24 * HOUR + HOUR).toISOString(),
        refundedAt: new Date(monthStart(now) + HOUR).toISOString(),
        amountVnd: -180_000,
      },
    ],
  };
}

export const monthOf = (iso: string) => currentMonth(new Date(iso));

export function summarize(data: MockEarnings, month: string): TutorEarningsSummary {
  const rows = data.items.filter((i) => monthOf(i.endAt) === month);
  const sum = (f: (i: TutorEarningItem) => number, only?: boolean) =>
    rows.filter((i) => only === undefined || i.settled === only).reduce((a, i) => a + f(i), 0);
  const adj = data.adjustments.filter((a) => a.month === month);
  return {
    month,
    timezone: 'Asia/Ho_Chi_Minh',
    isEmpty: rows.length === 0,
    sessionCount: rows.length,
    grossVnd: sum((i) => i.priceVnd),
    platformFeeVnd: sum((i) => i.platformFeeVnd),
    netVnd: sum((i) => i.netVnd),
    settledNetVnd: sum((i) => i.netVnd, true),
    unsettledNetVnd: sum((i) => i.netVnd, false),
    feeRate: MOCK_FEE_RATE,
    adjustmentsVnd: adj.reduce((a, x) => a + x.amountVnd, 0),
    adjustmentCount: adj.length,
  };
}
