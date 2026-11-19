/** Pure money and month rules of docs/specs/tutor-earnings.md (§4); no I/O so they are unit-testable. */

const RATE_SCALE = 10_000;
const HOUR_MS = 3_600_000;
/** Viet Nam has no DST, so Asia/Ho_Chi_Minh is a fixed UTC+7 offset. */
const VN_OFFSET_MS = 7 * HOUR_MS;

/** FEE_RATE (or a stored Decimal) as integer basis points: 0.1 -> 1000. */
export const toRateBp = (rate: number | { toString(): string }): number => Math.round(Number(rate.toString()) * RATE_SCALE);

/** `round_half_up(amount * rate)` in integer arithmetic, so no float error at .5 boundaries. */
export const platformFee = (amountVnd: number, rateBp: number): number =>
  Math.floor((amountVnd * rateBp + RATE_SCALE / 2) / RATE_SCALE);

export interface EarningsRow {
  amountVnd: number;
  platformFeeVnd: number;
  settled: boolean;
}

export interface EarningsTotals {
  sessions: number;
  grossVnd: number;
  platformFeeVnd: number;
  netVnd: number;
  settledNetVnd: number;
  unsettledNetVnd: number;
}

/** Sums per-session integers (fee already rounded per session), never rounding the total. */
export function totalsOf(rows: EarningsRow[]): EarningsTotals {
  const totals: EarningsTotals = { sessions: 0, grossVnd: 0, platformFeeVnd: 0, netVnd: 0, settledNetVnd: 0, unsettledNetVnd: 0 };
  for (const row of rows) {
    const net = row.amountVnd - row.platformFeeVnd;
    totals.sessions += 1;
    totals.grossVnd += row.amountVnd;
    totals.platformFeeVnd += row.platformFeeVnd;
    totals.netVnd += net;
    if (row.settled) totals.settledNetVnd += net;
    else totals.unsettledNetVnd += net;
  }
  return totals;
}

export interface MonthRange {
  month: string;
  /** Inclusive / exclusive UTC instants bounding the month in Asia/Ho_Chi_Minh. */
  from: Date;
  to: Date;
}

export const MAX_MONTHS_BACK = 23; // current month + 23 previous = the last 24 months

export const currentMonth = (now: Date): string => {
  const local = new Date(now.getTime() + VN_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthIndex = (month: string): number => {
  const [year, mon] = month.split('-').map(Number);
  return year! * 12 + (mon! - 1);
};

export function monthRange(month: string): MonthRange {
  const [year, mon] = month.split('-').map(Number);
  return {
    month,
    from: new Date(Date.UTC(year!, mon! - 1, 1) - VN_OFFSET_MS),
    to: new Date(Date.UTC(year!, mon!, 1) - VN_OFFSET_MS),
  };
}

export type MonthCheck = 'ok' | 'future' | 'too_old';

export function checkMonth(month: string, now: Date): MonthCheck {
  const diff = monthIndex(currentMonth(now)) - monthIndex(month);
  if (diff < 0) return 'future';
  return diff > MAX_MONTHS_BACK ? 'too_old' : 'ok';
}
