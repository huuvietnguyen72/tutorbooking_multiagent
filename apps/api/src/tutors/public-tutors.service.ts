import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import {
  SearchTutorsInput,
  toTutorPublic,
  toTutorSummary,
  tutorInclude,
  TutorPublicDto,
  TutorSummaryDto,
} from './tutors.dto';

/** Escape LIKE wildcards so `%` and `_` in `q` match literally (D4). */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Only tutors that are approved, active and have a price are public. */
export const publicTutorWhere: Prisma.TutorProfileWhereInput = {
  approvalStatus: 'APPROVED',
  pricePerSessionVnd: { not: null },
  user: { status: 'ACTIVE' },
};

@Injectable()
export class PublicTutorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private bookableFrom(): Date {
    return new Date(this.clock.now().getTime() + this.env.MIN_BOOKING_LEAD_MINUTES * 60_000);
  }

  async search(input: SearchTutorsInput): Promise<{ items: TutorSummaryDto[]; page: number; pageSize: number; total: number }> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`tp.approval_status = 'APPROVED' AND u.status = 'ACTIVE' AND tp.price_per_session_vnd IS NOT NULL`,
    ];
    const bookableFrom = this.bookableFrom();
    if (input.subjectId !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM tutor_subjects ts WHERE ts.tutor_id = tp.user_id AND ts.subject_id = ${input.subjectId})`,
      );
    }
    if (input.minPrice !== undefined) conditions.push(Prisma.sql`tp.price_per_session_vnd >= ${input.minPrice}`);
    if (input.maxPrice !== undefined) conditions.push(Prisma.sql`tp.price_per_session_vnd <= ${input.maxPrice}`);
    if (input.minRating !== undefined) conditions.push(Prisma.sql`tp.rating_avg >= ${input.minRating}`);
    if (input.q) conditions.push(Prisma.sql`u.full_name ILIKE ${`%${escapeLike(input.q)}%`} ESCAPE '\\'`);
    if (input.availableDate) {
      // Day boundaries in DISPLAY_TIMEZONE, converted by Postgres.
      const dayStart = Prisma.sql`((${input.availableDate}::date)::timestamp AT TIME ZONE ${this.env.DISPLAY_TIMEZONE})`;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM slots s
        WHERE s.tutor_id = tp.user_id AND s.status = 'AVAILABLE' AND s.deleted_at IS NULL
          AND s.start_at >= ${bookableFrom}
          AND s.start_at >= ${dayStart}
          AND s.start_at < (((${input.availableDate}::date + 1)::timestamp) AT TIME ZONE ${this.env.DISPLAY_TIMEZONE}))`);
    }

    const orderBy = {
      rating_desc: Prisma.sql`tp.rating_avg DESC, tp.rating_count DESC, tp.user_id`,
      price_asc: Prisma.sql`tp.price_per_session_vnd ASC, tp.user_id`,
      price_desc: Prisma.sql`tp.price_per_session_vnd DESC, tp.user_id`,
    }[input.sort];

    const offset = (input.page - 1) * input.pageSize;
    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT tp.user_id AS id FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY ${orderBy} LIMIT ${input.pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*) AS total FROM tutor_profiles tp JOIN users u ON u.id = tp.user_id
        WHERE ${Prisma.join(conditions, ' AND ')}`,
    ]);
    const total = Number(totalRows[0]?.total ?? 0);
    if (rows.length === 0) return { items: [], page: input.page, pageSize: input.pageSize, total };

    const ids = rows.map((r) => r.id);
    const [profiles, next] = await Promise.all([
      this.prisma.tutorProfile.findMany({ where: { userId: { in: ids } }, include: tutorInclude }),
      this.nextAvailable(ids),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const items = ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toTutorSummary(row, next.get(id) ?? null)] : [];
    });
    return { items, page: input.page, pageSize: input.pageSize, total };
  }

  async get(tutorId: string): Promise<TutorPublicDto> {
    const row = await this.prisma.tutorProfile.findFirst({
      where: { userId: tutorId, ...publicTutorWhere },
      include: tutorInclude,
    });
    if (!row) throw AppError.notFound();
    return toTutorPublic(row, (await this.nextAvailable([tutorId])).get(tutorId) ?? null);
  }

  /** Earliest bookable slot per tutor ("Lịch trống gần nhất"). */
  async nextAvailable(tutorIds: string[]): Promise<Map<string, Date>> {
    const groups = await this.prisma.slot.groupBy({
      by: ['tutorId'],
      where: { tutorId: { in: tutorIds }, status: 'AVAILABLE', deletedAt: null, startAt: { gte: this.bookableFrom() } },
      _min: { startAt: true },
    });
    const map = new Map<string, Date>();
    for (const g of groups) if (g._min.startAt) map.set(g.tutorId, g._min.startAt);
    return map;
  }
}
