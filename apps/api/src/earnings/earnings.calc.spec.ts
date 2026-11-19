import { checkMonth, currentMonth, monthRange, platformFee, toRateBp, totalsOf } from './earnings.calc';

describe('platformFee', () => {
  it('rounds half up in integer arithmetic', () => {
    expect(platformFee(200_000, 1000)).toBe(20_000);
    expect(platformFee(150_000, 1000)).toBe(15_000);
    expect(platformFee(333_333, 1000)).toBe(33_333); // 33333.3
    expect(platformFee(100_005, 1000)).toBe(10_001); // 10000.5 -> up
    expect(platformFee(100_004, 1000)).toBe(10_000); // 10000.4 -> down
    expect(platformFee(5, 1000)).toBe(1); // 0.5 -> 1
    expect(platformFee(15, 1000)).toBe(2); // 1.5 -> 2, a float 15 * 0.1 could miss
    expect(platformFee(0, 1000)).toBe(0);
  });

  it('handles other rates and extremes', () => {
    expect(platformFee(100_000, 0)).toBe(0);
    expect(platformFee(100_000, 10_000)).toBe(100_000);
    expect(platformFee(99_999, 1250)).toBe(12_500); // 12499.875
  });

  it('turns a rate into basis points without float drift', () => {
    expect(toRateBp(0.1)).toBe(1000);
    expect(toRateBp('0.1500')).toBe(1500);
    expect(toRateBp(0.0725)).toBe(725);
  });
});

describe('totalsOf', () => {
  it('sums per-session rounded fees, not a rounded total', () => {
    const rows = [100_005, 100_005].map((amountVnd) => ({ amountVnd, platformFeeVnd: platformFee(amountVnd, 1000), settled: false }));
    expect(totalsOf(rows)).toMatchObject({ sessions: 2, grossVnd: 200_010, platformFeeVnd: 20_002, netVnd: 180_008 });
    expect(platformFee(200_010, 1000)).toBe(20_001); // what rounding the total would (wrongly) give
  });

  it('matches the spec example and splits net by settlement', () => {
    const rows = [
      { amountVnd: 200_000, platformFeeVnd: 20_000, settled: true },
      { amountVnd: 150_000, platformFeeVnd: 15_000, settled: false },
      { amountVnd: 333_333, platformFeeVnd: 33_333, settled: false },
    ];
    const totals = totalsOf(rows);
    expect(totals).toEqual({
      sessions: 3,
      grossVnd: 683_333,
      platformFeeVnd: 68_333,
      netVnd: 615_000,
      settledNetVnd: 180_000,
      unsettledNetVnd: 435_000,
    });
    expect(totals.settledNetVnd + totals.unsettledNetVnd).toBe(totals.netVnd);
  });

  it('is all zeros for no rows', () => {
    expect(totalsOf([])).toEqual({ sessions: 0, grossVnd: 0, platformFeeVnd: 0, netVnd: 0, settledNetVnd: 0, unsettledNetVnd: 0 });
  });
});

describe('months in Asia/Ho_Chi_Minh', () => {
  it('bounds a month by the local midnight', () => {
    const { from, to } = monthRange('2026-06');
    expect(from.toISOString()).toBe('2026-05-31T17:00:00.000Z');
    expect(to.toISOString()).toBe('2026-06-30T17:00:00.000Z');
    expect(monthRange('2026-12').to.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('derives the current month in GMT+7', () => {
    expect(currentMonth(new Date('2026-05-31T16:59:59Z'))).toBe('2026-05');
    expect(currentMonth(new Date('2026-05-31T17:00:00Z'))).toBe('2026-06');
  });

  it('allows the current and 23 previous months only', () => {
    const now = new Date('2026-06-15T05:00:00Z');
    expect(checkMonth('2026-06', now)).toBe('ok');
    expect(checkMonth('2024-07', now)).toBe('ok');
    expect(checkMonth('2024-06', now)).toBe('too_old');
    expect(checkMonth('2026-07', now)).toBe('future');
  });
});
