import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/vi';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import i18n from '../i18n';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

/**
 * The only place that converts between UTC (API) and the display timezone.
 * Everything else passes ISO-8601 UTC strings around and calls these helpers.
 */
export const DISPLAY_TIMEZONE = 'Asia/Ho_Chi_Minh';

function inVn(iso: string | Date | Dayjs): Dayjs {
  return dayjs(iso).tz(DISPLAY_TIMEZONE);
}

/** `17/11/2026 19:00` */
export function formatDateTime(iso: string): string {
  return inVn(iso).format('DD/MM/YYYY HH:mm');
}

/** `17/11/2026` */
export function formatDate(iso: string): string {
  return inVn(iso).format('DD/MM/YYYY');
}

/** `19:00` */
export function formatTime(iso: string): string {
  return inVn(iso).format('HH:mm');
}

/** `19:00–20:00` */
export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`;
}

/** e.g. `Monday-name, 17/11/2026` with the Vietnamese weekday from vi.json. */
export function formatWeekdayDate(iso: string): string {
  const d = inVn(iso);
  return `${i18n.t(`time.weekdays.${d.day()}`)}, ${d.format('DD/MM/YYYY')}`;
}

/** `T2 17/11` */
export function formatShortDay(iso: string): string {
  const d = inVn(iso);
  return `${i18n.t(`time.weekdaysShort.${d.day()}`)} ${d.format('DD/MM')}`;
}

/** Calendar day in the display timezone, `YYYY-MM-DD`; used to group slots and as the API `availableDate`. */
export function dayKey(iso: string): string {
  return inVn(iso).format('YYYY-MM-DD');
}

/** Converts a calendar date picked in the UI (no timezone) to the API `date` format. */
export function toApiDate(date: Dayjs): string {
  return date.format('YYYY-MM-DD');
}

/** Parses an API `date` into a plain calendar date for date pickers. */
export function fromApiDate(value: string): Dayjs {
  return dayjs(value, 'YYYY-MM-DD');
}

/** Monday 00:00 (display timezone) of the week containing `iso`, as a UTC ISO string. */
export function startOfWeekIso(iso: string | Date = new Date()): string {
  const d = inVn(iso);
  const monday = d.subtract((d.day() + 6) % 7, 'day').startOf('day');
  return monday.toISOString();
}

/** Adds whole days in the display timezone (DST-safe), returns a UTC ISO string. */
export function addDaysIso(iso: string, days: number): string {
  return inVn(iso).add(days, 'day').toISOString();
}

/** The 7 day starts (UTC ISO) of the week beginning at `weekStartIso`. */
export function weekDays(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
}

/** `17–23/11/2026` header label for a week. */
export function formatWeekLabel(weekStartIso: string): string {
  const start = inVn(weekStartIso);
  const end = start.add(6, 'day');
  return `${start.format('DD')}–${end.format('DD/MM/YYYY')}`;
}

/** mm:ss countdown text, clamped at 00:00. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Combines a calendar date (`YYYY-MM-DD`) and a wall-clock time (`HH:mm`) in the display timezone into a UTC ISO string. */
export function toUtcIso(date: string, time: string): string {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', DISPLAY_TIMEZONE).toISOString();
}

/** `YYYY-MM-DD` of today in the display timezone. */
export function todayKey(): string {
  return inVn(new Date()).format('YYYY-MM-DD');
}

/** `HH:mm` of a UTC ISO string in the display timezone. */
export function timeKey(iso: string): string {
  return inVn(iso).format('HH:mm');
}

/** e.g. `Mon, 17/11/2026 19:00–20:00` (localised weekday) */
export function formatSession(startIso: string, endIso: string): string {
  return `${formatWeekdayDate(startIso)} ${formatTimeRange(startIso, endIso)}`;
}
