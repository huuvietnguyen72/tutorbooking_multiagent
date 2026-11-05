import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { Page } from '../bookings/bookings.service';
import { ReviewDto, ReviewsService } from '../reviews/reviews.service';
import { AuditLogDto, toAuditLog } from './admin.dto';

export interface AdminStats {
  pendingTutors: number;
  bookingsToday: number;
  confirmedUpcoming: number;
  refundsFailed: number;
}

@Injectable()
export class AdminOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly reviews: ReviewsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** "Today" = the calendar day in DISPLAY_TIMEZONE; counts CONFIRMED sessions starting that day. */
  async stats(): Promise<AdminStats> {
    const now = this.clock.now();
    const tz = this.env.DISPLAY_TIMEZONE;
    const [pendingTutors, confirmedUpcoming, refundsFailed, today] = await Promise.all([
      this.prisma.tutorProfile.count({ where: { approvalStatus: 'PENDING_APPROVAL' } }),
      this.prisma.booking.count({ where: { status: 'CONFIRMED', startAt: { gt: now } } }),
      this.prisma.payment.count({ where: { status: 'PAID', refundFailed: true } }),
      this.prisma.$queryRaw<{ n: number }[]>`
        WITH d AS (SELECT (date_trunc('day', ${now}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS s)
        SELECT count(*)::int AS n FROM bookings, d
        WHERE status = 'CONFIRMED' AND start_at >= d.s AND start_at < d.s + interval '1 day'`,
    ]);
    return { pendingTutors, bookingsToday: today[0]?.n ?? 0, confirmedUpcoming, refundsFailed };
  }

  async auditLogs(filter: { entityType?: string; entityId?: string }, page: number, pageSize: number): Promise<Page<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows.map(toAuditLog), page, pageSize, total };
  }

  /** Optional moderation: hide/restore one review; tutor rating is recomputed in the same transaction. */
  hideReview(adminId: string, reviewId: string, hidden: boolean): Promise<ReviewDto> {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.reviews.setHidden(tx, reviewId, hidden);
      if (!result) throw AppError.notFound();
      if (result.changed) {
        await recordAudit(tx, {
          actorId: adminId,
          action: hidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
          entityType: 'review',
          entityId: reviewId,
        });
      }
      return result.review;
    });
  }
}
