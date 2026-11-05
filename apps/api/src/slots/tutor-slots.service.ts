import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Slot } from '@prisma/client';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import type { TutorSlotDto } from './slots.dto';

const overlap = () => new AppError(409, 'SLOT_OVERLAP', 'Slot overlaps another slot');

/** `slots_no_overlap` exclusion constraint (SQLSTATE 23P01) is the final guard against overlaps. */
function isOverlapViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /slots_no_overlap|23P01/.test(error.message) || JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('23P01');
  }
  return false;
}

type SlotWithBooking = Slot & { bookings: { id: string; code: bigint; student: { fullName: string } }[] };

@Injectable()
export class TutorSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private toDto(slot: SlotWithBooking): TutorSlotDto {
    const booking = slot.status === 'BOOKED' ? slot.bookings[0] : undefined;
    return {
      id: slot.id,
      startAt: slot.startAt.toISOString(),
      endAt: slot.endAt.toISOString(),
      status: slot.status,
      booking: booking
        ? { id: booking.id, code: `#BK-${booking.code}`, studentName: booking.student.fullName }
        : null,
    };
  }

  private readonly include = {
    bookings: {
      where: { status: 'CONFIRMED' as const },
      select: { id: true, code: true, student: { select: { fullName: true } } },
      take: 1,
    },
  };

  /** Slots can only be created/changed by an APPROVED tutor (US-TUT-01, §3.4). */
  private async requireApproved(tutorId: string): Promise<void> {
    const profile = await this.prisma.tutorProfile.findUnique({
      where: { userId: tutorId },
      select: { approvalStatus: true },
    });
    if (profile?.approvalStatus !== 'APPROVED') {
      throw new AppError(403, 'TUTOR_NOT_ACCEPTING', 'Tutor is not approved');
    }
  }

  private endOf(startAt: Date): Date {
    return new Date(startAt.getTime() + this.env.SLOT_DURATION_MINUTES * 60_000);
  }

  private requireFuture(startAt: Date, field: string): void {
    if (startAt.getTime() <= this.clock.now().getTime()) {
      throw AppError.validation([{ field, code: 'must_be_future' }]);
    }
  }

  async list(tutorId: string, from: Date, to: Date): Promise<TutorSlotDto[]> {
    const slots = await this.prisma.slot.findMany({
      where: { tutorId, deletedAt: null, startAt: { gte: from, lt: to } },
      orderBy: { startAt: 'asc' },
      include: this.include,
    });
    return slots.map((s) => this.toDto(s));
  }

  async create(tutorId: string, startTimes: Date[]): Promise<TutorSlotDto[]> {
    await this.requireApproved(tutorId);
    startTimes.forEach((t, i) => this.requireFuture(t, `startTimes.${i}`));
    const sorted = [...startTimes].sort((a, b) => a.getTime() - b.getTime());
    const length = this.env.SLOT_DURATION_MINUTES * 60_000;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].getTime() - sorted[i - 1].getTime() < length) throw overlap();
    }
    // Concurrent GiST exclusion checks can deadlock before PostgreSQL reports
    // an overlap. Retry the whole rolled-back transaction so the winner commits
    // and the losing request receives the existing SLOT_OVERLAP response.
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.prisma.$transaction(
          sorted.map((startAt) =>
            this.prisma.slot.create({ data: { tutorId, startAt, endAt: this.endOf(startAt) }, include: this.include }),
          ),
        );
        return created.map((s) => this.toDto(s));
      } catch (error) {
        if (isOverlapViolation(error)) throw overlap();
        const deadlock = error instanceof Prisma.PrismaClientKnownRequestError
          ? error.code === 'P2034'
          : error instanceof Prisma.PrismaClientUnknownRequestError && /40P01/.test(error.message);
        if (!deadlock || attempt >= 3) throw error;
      }
    }
  }

  /** 404 for slots that are missing, deleted or owned by someone else. */
  private async owned(tutorId: string, slotId: string): Promise<Slot> {
    const slot = await this.prisma.slot.findFirst({ where: { id: slotId, tutorId, deletedAt: null } });
    if (!slot) throw AppError.notFound();
    return slot;
  }

  private lockedOr(slot: Slot): AppError {
    return slot.status === 'HELD' || slot.status === 'BOOKED'
      ? new AppError(409, 'SLOT_LOCKED', 'Slot is held or booked')
      : new AppError(409, 'INVALID_STATE', 'Slot is in the wrong state');
  }

  async move(tutorId: string, slotId: string, startAt: Date): Promise<TutorSlotDto> {
    await this.requireApproved(tutorId);
    const slot = await this.owned(tutorId, slotId);
    if (slot.status !== 'AVAILABLE') throw this.lockedOr(slot);
    this.requireFuture(startAt, 'startAt');
    try {
      // Status condition in the UPDATE guards against a booking taking the slot between read and write.
      const result = await this.prisma.slot.updateMany({
        where: { id: slotId, tutorId, status: 'AVAILABLE', deletedAt: null },
        data: { startAt, endAt: this.endOf(startAt) },
      });
      if (result.count === 0) throw new AppError(409, 'SLOT_LOCKED', 'Slot is held or booked');
    } catch (error) {
      if (isOverlapViolation(error)) throw overlap();
      throw error;
    }
    return this.toDto(await this.prisma.slot.findUniqueOrThrow({ where: { id: slotId }, include: this.include }));
  }

  async remove(tutorId: string, slotId: string): Promise<void> {
    const slot = await this.owned(tutorId, slotId);
    if (slot.status !== 'AVAILABLE' && slot.status !== 'CLOSED') throw this.lockedOr(slot);
    const result = await this.prisma.slot.updateMany({
      where: { id: slotId, tutorId, status: { in: ['AVAILABLE', 'CLOSED'] }, deletedAt: null },
      data: { deletedAt: this.clock.now() },
    });
    if (result.count === 0) throw new AppError(409, 'SLOT_LOCKED', 'Slot is held or booked');
  }

  async reopen(tutorId: string, slotId: string): Promise<TutorSlotDto> {
    await this.requireApproved(tutorId);
    const slot = await this.owned(tutorId, slotId);
    if (slot.status !== 'CLOSED') throw new AppError(409, 'INVALID_STATE', 'Only closed slots can be reopened');
    if (slot.startAt.getTime() <= this.clock.now().getTime()) {
      throw new AppError(409, 'SLOT_TOO_SOON', 'Slot is in the past');
    }
    try {
      const result = await this.prisma.slot.updateMany({
        where: { id: slotId, tutorId, status: 'CLOSED', deletedAt: null },
        data: { status: 'AVAILABLE' },
      });
      if (result.count === 0) throw new AppError(409, 'INVALID_STATE', 'Slot is in the wrong state');
    } catch (error) {
      if (isOverlapViolation(error)) throw overlap();
      throw error;
    }
    return this.toDto(await this.prisma.slot.findUniqueOrThrow({ where: { id: slotId }, include: this.include }));
  }
}
