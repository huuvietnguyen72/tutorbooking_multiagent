import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatBookingCode } from '../bookings/booking-code';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { checkMonth, currentMonth, monthRange, MonthRange, platformFee, toRateBp, totalsOf } from './earnings.calc';
import type {
  AdjustmentItemDto,
  CancelledItemDto,
  EarningItemDto,
  EarningItemsDto,
  EarningsSummaryDto,
} from './earnings.dto';

const CANCEL_ROLE = { CANCELLED_BY_STUDENT: 'STUDENT', CANCELLED_BY_TUTOR: 'TUTOR', CANCELLED_BY_ADMIN: 'ADMIN' } as const;

type Settlement = 'all' | 'settled' | 'unsettled';

interface FeeFields {
  amountVnd: number;
  platformFeeVnd: number | null;
  feeRate: { toString(): string } | null;
}

/**
 * Read side of the tutor earnings report (docs/specs/tutor-earnings.md). Always scoped to the
 * caller's id; the summary and the item list share one `eligibleWhere` and one per-row fee, so the
 * rows add up to the totals exactly.
 */
@Injectable()
export class EarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Defaults to the current month in Asia/Ho_Chi_Minh; future months and months older than 24 are a 400. */
  resolveMonth(month: string | undefined): MonthRange {
    const now = this.clock.now();
    const value = month ?? currentMonth(now);
    const check = checkMonth(value, now);
    if (check !== 'ok') throw AppError.validation([{ field: 'month', code: check === 'future' ? 'month_in_future' : 'month_too_old' }]);
    return monthRange(value);
  }

  /** Stored snapshot; the env rate only fills a payment that predates the snapshot columns. */
  feeOf(payment: FeeFields): number {
    return payment.platformFeeVnd ?? platformFee(payment.amountVnd, toRateBp(payment.feeRate ?? this.env.FEE_RATE));
  }

  /**
   * CONFIRMED, finished, PAID, ending in the month (§4.1); `tutorId` undefined spans every tutor (admin list). A payment refunded *after* its month was
   * settled stays here, so the closed month never changes; the refund shows up as an adjustment (Q3).
   */
  eligibleWhere(tutorId: string | undefined, range: MonthRange, settlement: Settlement = 'all'): Prisma.PaymentWhereInput {
    return {
      OR: [{ status: 'PAID' }, { status: 'REFUNDED', settledAt: { not: null } }],
      ...(settlement === 'settled' ? { settledAt: { not: null } } : settlement === 'unsettled' ? { settledAt: null } : {}),
      booking: { ...(tutorId ? { tutorId } : {}), status: 'CONFIRMED', endAt: { gte: range.from, lt: range.to, lte: this.clock.now() } },
    };
  }

  private adjustmentWhere(tutorId: string, range: MonthRange): Prisma.PaymentWhereInput {
    return {
      status: 'REFUNDED',
      settledAt: { not: null },
      refundedAt: { gte: range.from, lt: range.to },
      booking: { tutorId },
    };
  }

  async summary(tutorId: string, month: string | undefined): Promise<EarningsSummaryDto> {
    const range = this.resolveMonth(month);
    const [paid, refunded] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: this.eligibleWhere(tutorId, range),
        select: { amountVnd: true, platformFeeVnd: true, feeRate: true, settledAt: true },
      }),
      this.prisma.payment.findMany({
        where: this.adjustmentWhere(tutorId, range),
        select: { amountVnd: true, platformFeeVnd: true, feeRate: true },
      }),
    ]);
    const totals = totalsOf(paid.map((p) => ({ amountVnd: p.amountVnd, platformFeeVnd: this.feeOf(p), settled: p.settledAt !== null })));
    const rates = new Set(paid.map((p) => toRateBp(p.feeRate ?? this.env.FEE_RATE)));
    const feeRate = paid.length === 0 ? this.env.FEE_RATE : rates.size === 1 ? [...rates][0]! / 10_000 : null;
    return {
      month: range.month,
      timezone: 'Asia/Ho_Chi_Minh',
      isEmpty: totals.sessions === 0,
      sessionCount: totals.sessions,
      grossVnd: totals.grossVnd,
      platformFeeVnd: totals.platformFeeVnd,
      netVnd: totals.netVnd,
      settledNetVnd: totals.settledNetVnd,
      unsettledNetVnd: totals.unsettledNetVnd,
      feeRate,
      adjustmentsVnd: -refunded.reduce((sum, p) => sum + p.amountVnd - this.feeOf(p), 0),
      adjustmentCount: refunded.length,
    };
  }

  async items(
    tutorId: string,
    q: { month?: string; settlement: Settlement; page: number; pageSize: number; sort: 'startAt:desc' | 'startAt:asc' },
  ): Promise<EarningItemsDto> {
    const range = this.resolveMonth(q.month);
    const where = this.eligibleWhere(tutorId, range, q.settlement);
    const dir = q.sort === 'startAt:asc' ? 'asc' : 'desc';
    const student = { select: { fullName: true } } as const;

    const [rows, total, cancelled, adjustments] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: [{ booking: { startAt: dir } }, { id: dir }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          amountVnd: true,
          platformFeeVnd: true,
          feeRate: true,
          settledAt: true,
          booking: { select: { id: true, code: true, startAt: true, endAt: true, priceVnd: true, student } },
        },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.booking.findMany({
        where: {
          tutorId,
          endAt: { gte: range.from, lt: range.to },
          OR: [
            { status: { in: ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'] }, payment: { paidAt: { not: null } } },
            { payment: { status: 'REFUNDED', settledAt: null } },
          ],
        },
        orderBy: [{ startAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          code: true,
          status: true,
          startAt: true,
          endAt: true,
          priceVnd: true,
          cancelReason: true,
          student,
          payment: { select: { status: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: this.adjustmentWhere(tutorId, range),
        orderBy: [{ refundedAt: 'desc' }, { id: 'desc' }],
        select: {
          amountVnd: true,
          platformFeeVnd: true,
          feeRate: true,
          refundedAt: true,
          booking: { select: { id: true, code: true, startAt: true, endAt: true, student } },
        },
      }),
    ]);

    return {
      month: range.month,
      page: q.page,
      pageSize: q.pageSize,
      total,
      items: rows.map((row): EarningItemDto => {
        const fee = this.feeOf(row);
        return {
          bookingId: row.booking.id,
          code: formatBookingCode(row.booking.code),
          studentName: row.booking.student.fullName,
          startAt: row.booking.startAt.toISOString(),
          endAt: row.booking.endAt.toISOString(),
          priceVnd: row.amountVnd,
          platformFeeVnd: fee,
          netVnd: row.amountVnd - fee,
          settled: row.settledAt !== null,
          settledAt: row.settledAt?.toISOString() ?? null,
        };
      }),
      cancelled: cancelled.map((b): CancelledItemDto => {
        const role = CANCEL_ROLE[b.status as keyof typeof CANCEL_ROLE] ?? null;
        return {
          bookingId: b.id,
          code: formatBookingCode(b.code),
          studentName: b.student.fullName,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          priceVnd: b.priceVnd,
          status: b.status,
          refunded: b.payment?.status === 'REFUNDED',
          cancelledByRole: role,
          tutorCancelReason: role === 'TUTOR' ? b.cancelReason : null,
        };
      }),
      adjustments: adjustments.map((p): AdjustmentItemDto => ({
        bookingId: p.booking.id,
        code: formatBookingCode(p.booking.code),
        studentName: p.booking.student.fullName,
        startAt: p.booking.startAt.toISOString(),
        endAt: p.booking.endAt.toISOString(),
        refundedAt: p.refundedAt!.toISOString(),
        amountVnd: -(p.amountVnd - this.feeOf(p)),
      })),
    };
  }
}
