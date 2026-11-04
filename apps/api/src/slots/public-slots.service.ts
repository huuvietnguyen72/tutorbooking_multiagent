import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { PublicTutorsService, publicTutorWhere } from '../tutors/public-tutors.service';
import { toTutorSummary, tutorInclude, TutorSummaryDto } from '../tutors/tutors.dto';
import type { PublicSlotDto } from './slots.dto';

@Injectable()
export class PublicSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly tutors: PublicTutorsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private toPublic(slot: { id: string; startAt: Date; endAt: Date; status: string }): PublicSlotDto {
    const bookableFrom = this.clock.now().getTime() + this.env.MIN_BOOKING_LEAD_MINUTES * 60_000;
    const bookable = slot.status === 'AVAILABLE' && slot.startAt.getTime() >= bookableFrom;
    return {
      id: slot.id,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      status: bookable ? 'AVAILABLE' : 'UNAVAILABLE',
    };
  }

  /** HELD/BOOKED/too-soon collapse to UNAVAILABLE; CLOSED, deleted and past slots are hidden. */
  async listForTutor(tutorId: string, from: Date, to: Date): Promise<PublicSlotDto[]> {
    const tutor = await this.prisma.tutorProfile.findFirst({
      where: { userId: tutorId, ...publicTutorWhere },
      select: { userId: true },
    });
    if (!tutor) throw AppError.notFound();
    const slots = await this.prisma.slot.findMany({
      where: {
        tutorId,
        deletedAt: null,
        status: { not: 'CLOSED' },
        startAt: { gte: new Date(Math.max(from.getTime(), this.clock.now().getTime())), lt: to },
      },
      orderBy: { startAt: 'asc' },
    });
    return slots.map((s) => this.toPublic(s));
  }

  async get(slotId: string): Promise<PublicSlotDto & { tutor: TutorSummaryDto; priceVnd: number }> {
    const slot = await this.prisma.slot.findFirst({
      where: { id: slotId, deletedAt: null, status: { not: 'CLOSED' } },
    });
    const profile = slot
      ? await this.prisma.tutorProfile.findFirst({
          where: { userId: slot.tutorId, ...publicTutorWhere },
          include: tutorInclude,
        })
      : null;
    if (!slot || !profile) throw AppError.notFound();
    const next = (await this.tutors.nextAvailable([slot.tutorId])).get(slot.tutorId) ?? null;
    return {
      ...this.toPublic(slot),
      tutor: toTutorSummary(profile, next),
      priceVnd: profile.pricePerSessionVnd ?? 0,
    };
  }
}
