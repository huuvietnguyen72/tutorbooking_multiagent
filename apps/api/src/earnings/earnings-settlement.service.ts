import { Injectable } from '@nestjs/common';
import { recordAudit } from '../audit/audit';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { currentMonth, monthRange } from './earnings.calc';
import type { SettlementResultDto } from './earnings.dto';
import { EarningsService } from './earnings.service';

/** Admin marks a tutor's finished month as paid out (Q2). One-way: nothing here clears `settledAt`. */
@Injectable()
export class EarningsSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly earnings: EarningsService,
  ) {}

  /**
   * Settles every still-unsettled eligible session of `tutorId` whose `endAt` falls in `month`.
   * Idempotent: a repeat finds nothing to do, changes nothing and writes no second audit row.
   * Only months that have fully ended can be settled, so a later session can never slip into a closed month.
   */
  async settleMonth(adminId: string, tutorId: string, month: string): Promise<SettlementResultDto> {
    const now = this.clock.now();
    if (month >= currentMonth(now)) {
      throw new AppError(409, 'INVALID_STATE', 'Only a month that has ended can be settled', { current: 'MONTH_NOT_ENDED' });
    }
    const range = monthRange(month);

    return this.prisma.$transaction(async (tx) => {
      // Serialises concurrent settlements of one tutor; a non-TUTOR user has no profile row -> 404.
      const locked = await tx.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM tutor_profiles WHERE user_id = ${tutorId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw AppError.notFound();

      const open = await tx.payment.findMany({
        where: this.earnings.eligibleWhere(tutorId, range, 'unsettled'),
        select: { id: true },
      });
      const ids = open.map((p) => p.id);
      // `status: PAID` is re-checked by the UPDATE itself, so a refund racing this call wins.
      const { count } = await tx.payment.updateMany({
        where: { id: { in: ids }, status: 'PAID', settledAt: null },
        data: { settledAt: now, settledBy: adminId },
      });
      const settled = await tx.payment.findMany({
        where: { id: { in: ids }, status: 'PAID', settledAt: { not: null }, settledBy: adminId },
        select: { amountVnd: true, platformFeeVnd: true, feeRate: true },
      });
      const settledNetVnd = settled.reduce((sum, p) => sum + p.amountVnd - this.earnings.feeOf(p), 0);
      const alreadySettledCount = await tx.payment.count({ where: this.earnings.eligibleWhere(tutorId, range, 'settled') }) - count;

      if (count > 0) {
        await recordAudit(tx, {
          actorId: adminId,
          action: 'TUTOR_EARNINGS_SETTLED',
          entityType: 'TutorEarnings',
          entityId: `${tutorId}:${month}`,
          metadata: { tutorId, month, settledCount: count, settledNetVnd },
        });
      }
      return { tutorId, month, settledCount: count, alreadySettledCount, settledNetVnd };
    });
  }
}
