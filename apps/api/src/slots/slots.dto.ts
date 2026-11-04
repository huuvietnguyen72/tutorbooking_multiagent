import { z } from 'zod';

/** ISO-8601 with an explicit offset; offset-less input is rejected (NFR-2). */
export const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const MAX_RANGE_MS = 31 * 86_400_000;

export const rangeSchema = z
  .object({ from: instant, to: instant })
  .refine((r) => !(r.from instanceof Date && r.to instanceof Date) || r.to > r.from, { path: ['to'], message: 'to_before_from' })
  .refine((r) => !(r.from instanceof Date && r.to instanceof Date) || r.to.getTime() - r.from.getTime() <= MAX_RANGE_MS, {
    path: ['to'],
    message: 'range_too_long',
  });

export const createSlotsSchema = z.object({ startTimes: z.array(instant).min(1).max(50) }).strict();

export const moveSlotSchema = z.object({ startAt: instant }).strict();

export interface PublicSlotDto {
  id: string;
  startAt: string;
  endAt: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface TutorSlotDto {
  id: string;
  startAt: string;
  endAt: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'CLOSED';
  booking: { id: string; code: string; studentName: string } | null;
}
