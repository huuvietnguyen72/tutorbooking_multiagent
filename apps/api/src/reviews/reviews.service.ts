import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { TX_OPTIONS } from '../bookings/booking-expiry.service';
import { BookingStateMachine, Tx } from '../bookings/booking-state-machine';
import { reviewPolicy } from '../bookings/booking.policy';
import { PublicReviewDto, ReviewDto, toPublicReview, toReview } from './reviews.dto';

export type { ReviewDto, PublicReviewDto };

export interface ReviewPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const withStudent = { student: { select: { fullName: true } } } as const;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly machine: BookingStateMachine,
  ) {}

  /** One review per finished, paid booking; rating aggregates move in the same transaction. */
  async create(studentId: string, bookingId: string, rating: number, comment: string | null): Promise<ReviewDto> {
    const owned = await this.prisma.booking.findFirst({ where: { id: bookingId, studentId }, select: { id: true } });
    if (!owned) throw AppError.notFound(); // ownership in the query: foreign ids look unknown
    try {
      return await this.prisma.$transaction(async (tx) => {
        const booking = await this.machine.lockBooking(tx, bookingId);
        if (!booking || booking.studentId !== studentId) throw AppError.notFound();
        // Serializes rating math per tutor: two students reviewing at once must not overwrite each other's average.
        await tx.$queryRaw`SELECT user_id FROM tutor_profiles WHERE user_id = ${booking.tutorId}::uuid FOR UPDATE`;
        const existing = await tx.review.findUnique({ where: { bookingId }, select: { id: true } });
        const decision = reviewPolicy(booking, this.clock.now(), existing !== null);
        if (!decision.allowed) throw new AppError(409, decision.code, 'Booking cannot be reviewed');

        const row = await tx.review.create({
          data: { bookingId, studentId, tutorId: booking.tutorId, rating, comment: comment || null },
          include: withStudent,
        });
        await this.recomputeRating(tx, booking.tutorId);
        return toReview(row);
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(409, 'ALREADY_REVIEWED', 'Booking already reviewed');
      }
      throw error;
    }
  }

  /** Public list: only APPROVED tutors exist publicly (A5), hidden reviews never show (A2). */
  async listPublic(tutorId: string, page: number, pageSize: number): Promise<ReviewPage<PublicReviewDto>> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { userId: tutorId, approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } },
      select: { userId: true },
    });
    if (!tutor) throw AppError.notFound();
    return this.listFor(tutorId, page, pageSize);
  }

  /** The tutor's own reviews, whatever their approval status. */
  listMine(tutorId: string, page: number, pageSize: number): Promise<ReviewPage<PublicReviewDto>> {
    return this.listFor(tutorId, page, pageSize);
  }

  private async listFor(tutorId: string, page: number, pageSize: number): Promise<ReviewPage<PublicReviewDto>> {
    const where: Prisma.ReviewWhereInput = { tutorId, isHidden: false };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: withStudent,
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items: rows.map(toPublicReview), page, pageSize, total };
  }

  /** Admin moderation (optional in the MVP): hiding or restoring recomputes the tutor's rating. */
  async setHidden(tx: Tx, reviewId: string, hidden: boolean): Promise<{ review: ReviewDto; changed: boolean } | null> {
    const found = await tx.review.findUnique({ where: { id: reviewId }, select: { tutorId: true } });
    if (!found) return null;
    await tx.$queryRaw`SELECT user_id FROM tutor_profiles WHERE user_id = ${found.tutorId}::uuid FOR UPDATE`;
    const current = await tx.review.findUniqueOrThrow({ where: { id: reviewId } });
    const changed = current.isHidden !== hidden;
    if (changed) {
      await tx.review.update({ where: { id: reviewId }, data: { isHidden: hidden } });
      await this.recomputeRating(tx, found.tutorId);
    }
    const row = await tx.review.findUniqueOrThrow({ where: { id: reviewId }, include: withStudent });
    return { review: toReview(row), changed };
  }

  /** Denormalized `rating_avg`/`rating_count` over visible reviews; callers hold the tutor_profiles row lock. */
  async recomputeRating(tx: Tx, tutorId: string): Promise<void> {
    const agg = await tx.review.aggregate({
      where: { tutorId, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const avg = agg._avg.rating === null ? 0 : Math.round(agg._avg.rating * 100) / 100;
    await tx.tutorProfile.update({ where: { userId: tutorId }, data: { ratingAvg: avg, ratingCount: agg._count._all } });
  }
}
