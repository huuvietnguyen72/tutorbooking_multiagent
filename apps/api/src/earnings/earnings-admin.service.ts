import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { currentMonth, EarningsRow, totalsOf } from './earnings.calc';
import type { AdminEarningsDto, AdminEarningsRowDto, EarningItemsDto } from './earnings.dto';
import { EarningsService } from './earnings.service';

/**
 * Admin read side of the earnings report. It adds no money logic: the month range, the eligible
 * payments, the per-session fee and the totals all come from `EarningsService` / `earnings.calc`,
 * the same ones behind `GET /tutor/earnings*`, so the figures match what each tutor sees.
 */
@Injectable()
export class AdminEarningsReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly earnings: EarningsService,
  ) {}

  /** Every tutor with at least one counted session in the month, ordered by name. */
  async list(q: { month?: string; page: number; pageSize: number }): Promise<AdminEarningsDto> {
    const range = this.earnings.resolveMonth(q.month);
    const payments = await this.prisma.payment.findMany({
      where: this.earnings.eligibleWhere(undefined, range),
      select: {
        amountVnd: true,
        platformFeeVnd: true,
        feeRate: true,
        settledAt: true,
        booking: { select: { tutorId: true, tutor: { select: { fullName: true } } } },
      },
    });

    const byTutor = new Map<string, { name: string; rows: EarningsRow[] }>();
    for (const p of payments) {
      const entry = byTutor.get(p.booking.tutorId) ?? { name: p.booking.tutor.fullName, rows: [] };
      entry.rows.push({ amountVnd: p.amountVnd, platformFeeVnd: this.earnings.feeOf(p), settled: p.settledAt !== null });
      byTutor.set(p.booking.tutorId, entry);
    }

    const all = [...byTutor.entries()]
      .map(([tutorId, { name, rows }]): AdminEarningsRowDto => {
        const totals = totalsOf(rows);
        const settledCount = rows.filter((r) => r.settled).length;
        return {
          tutorId,
          tutorName: name,
          sessionCount: totals.sessions,
          grossVnd: totals.grossVnd,
          platformFeeVnd: totals.platformFeeVnd,
          netVnd: totals.netVnd,
          settledNetVnd: totals.settledNetVnd,
          unsettledNetVnd: totals.unsettledNetVnd,
          settledCount,
          unsettledCount: totals.sessions - settledCount,
        };
      })
      .sort((a, b) => a.tutorName.localeCompare(b.tutorName, 'vi') || a.tutorId.localeCompare(b.tutorId));

    return {
      month: range.month,
      monthClosed: range.month < currentMonth(this.clock.now()),
      page: q.page,
      pageSize: q.pageSize,
      total: all.length,
      items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    };
  }

  /** The tutor's own `items` report for the month, so rows add up to the list above and to `/tutor/earnings`. */
  async items(tutorId: string, q: Parameters<EarningsService['items']>[1]): Promise<EarningItemsDto> {
    const profile = await this.prisma.tutorProfile.findUnique({ where: { userId: tutorId }, select: { userId: true } });
    if (!profile) throw AppError.notFound();
    return this.earnings.items(tutorId, q);
  }
}
