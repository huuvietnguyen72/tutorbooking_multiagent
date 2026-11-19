import { z } from 'zod';

const intParam = z.coerce.number().int();

/** `YYYY-MM` with a real month; range (future / older than 24 months) is checked against the clock in the service. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const earningsQuerySchema = z.object({ month: monthSchema.optional() }).strict();

export const SORTS = ['startAt:desc', 'startAt:asc'] as const;

export const earningsItemsQuerySchema = z
  .object({
    month: monthSchema.optional(),
    settlement: z.enum(['all', 'settled', 'unsettled']).default('all'),
    page: intParam.min(1).max(100_000).default(1),
    pageSize: intParam.min(1).max(100).default(20),
    sort: z.enum(SORTS).default('startAt:desc'),
  })
  .strict();

export const adminEarningsQuerySchema = z
  .object({
    month: monthSchema.optional(),
    page: intParam.min(1).max(100_000).default(1),
    pageSize: intParam.min(1).max(100).default(20),
  })
  .strict();

export const settlementBodySchema = z.object({}).strict();

export interface EarningsSummaryDto {
  month: string;
  timezone: 'Asia/Ho_Chi_Minh';
  isEmpty: boolean;
  sessionCount: number;
  grossVnd: number;
  platformFeeVnd: number;
  netVnd: number;
  settledNetVnd: number;
  unsettledNetVnd: number;
  /** Rate shared by every session in the month; null when the month mixes rates. Falls back to the current config when empty. */
  feeRate: number | null;
  /** Refunds of already-settled sessions that happened this month (Q3); never part of the figures above. */
  adjustmentsVnd: number;
  adjustmentCount: number;
}

export interface EarningItemDto {
  bookingId: string;
  code: string;
  studentName: string;
  startAt: string;
  endAt: string;
  priceVnd: number;
  platformFeeVnd: number;
  netVnd: number;
  settled: boolean;
  settledAt: string | null;
}

export interface CancelledItemDto {
  bookingId: string;
  code: string;
  studentName: string;
  startAt: string;
  endAt: string;
  priceVnd: number;
  status: string;
  refunded: boolean;
  cancelledByRole: 'STUDENT' | 'TUTOR' | 'ADMIN' | null;
  tutorCancelReason: string | null;
}

export interface AdjustmentItemDto {
  bookingId: string;
  code: string;
  studentName: string;
  startAt: string;
  endAt: string;
  refundedAt: string;
  /** Negative: the net amount that had been settled and was then refunded. */
  amountVnd: number;
}

export interface EarningItemsDto {
  month: string;
  page: number;
  pageSize: number;
  total: number;
  items: EarningItemDto[];
  cancelled: CancelledItemDto[];
  adjustments: AdjustmentItemDto[];
}

export interface SettlementResultDto {
  tutorId: string;
  month: string;
  settledCount: number;
  alreadySettledCount: number;
  settledNetVnd: number;
}

export interface AdminEarningsRowDto {
  tutorId: string;
  tutorName: string;
  sessionCount: number;
  grossVnd: number;
  platformFeeVnd: number;
  netVnd: number;
  settledNetVnd: number;
  unsettledNetVnd: number;
  settledCount: number;
  unsettledCount: number;
}

export interface AdminEarningsDto {
  month: string;
  /** True once the month has ended (Asia/Ho_Chi_Minh), i.e. PUT settlement is accepted for it. */
  monthClosed: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: AdminEarningsRowDto[];
}
