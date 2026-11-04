import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  dayKey,
  formatCountdown,
  formatDateTime,
  formatTimeRange,
  formatWeekdayDate,
  startOfWeekIso,
  toApiDate,
  weekDays,
} from './time';
import dayjs from 'dayjs';

describe('lib/time (UTC <-> Asia/Ho_Chi_Minh)', () => {
  it('formats UTC instants in GMT+7', () => {
    expect(formatDateTime('2026-11-17T12:00:00Z')).toBe('17/11/2026 19:00');
    expect(formatTimeRange('2026-11-17T12:00:00Z', '2026-11-17T13:00:00Z')).toBe('19:00–20:00');
  });

  it('rolls over to the next calendar day after 17:00 UTC', () => {
    expect(formatDateTime('2026-11-17T18:30:00Z')).toBe('18/11/2026 01:30');
    expect(dayKey('2026-11-17T18:30:00Z')).toBe('2026-11-18');
  });

  it('formats weekday labels in Vietnamese', () => {
    expect(formatWeekdayDate('2026-11-17T12:00:00Z')).toBe('Thứ Ba, 17/11/2026');
  });

  it('finds Monday 00:00 GMT+7 as the week start', () => {
    // Tue 17/11/2026 19:00 GMT+7 -> Mon 16/11/2026 00:00 GMT+7 = Sun 15/11 17:00 UTC
    expect(startOfWeekIso('2026-11-17T12:00:00Z')).toBe('2026-11-15T17:00:00.000Z');
    // Sunday evening GMT+7 still belongs to the week that started on the previous Monday.
    expect(startOfWeekIso('2026-11-22T16:00:00Z')).toBe('2026-11-15T17:00:00.000Z');
    // Sunday 17:30 UTC is already Monday 00:30 GMT+7 -> next week.
    expect(startOfWeekIso('2026-11-22T17:30:00Z')).toBe('2026-11-22T17:00:00.000Z');
  });

  it('builds 7 consecutive day starts', () => {
    const days = weekDays('2026-11-15T17:00:00.000Z');
    expect(days).toHaveLength(7);
    expect(days.map(dayKey)).toEqual([
      '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
    ]);
    expect(addDaysIso(days[0], 7)).toBe('2026-11-22T17:00:00.000Z');
  });

  it('formats pure calendar dates for the API without a timezone shift', () => {
    expect(toApiDate(dayjs('2026-11-17T00:00:00'))).toBe('2026-11-17');
  });

  it('formats countdowns as mm:ss and clamps at zero', () => {
    expect(formatCountdown(14 * 60_000 + 32_000)).toBe('14:32');
    expect(formatCountdown(-5)).toBe('00:00');
  });
});
