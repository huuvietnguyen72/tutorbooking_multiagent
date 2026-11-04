import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { BookingStateMachine, SYSTEM } from './booking-state-machine';

export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
const BATCH = 100;

/**
 * US-SYS-02: releases PENDING_PAYMENT holds past `hold_expires_at`. Runs on a timer
 * (`EXPIRY_JOB_INTERVAL_SECONDS`, 0 = off) and lazily from reads/writes of the same booking or slot.
 */
@Injectable()
export class BookingExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly machine: BookingStateMachine,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.EXPIRY_JOB_INTERVAL_SECONDS === 0) return;
    this.timer = setInterval(() => void this.tick(), this.env.EXPIRY_JOB_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.runOnce();
      if (expired > 0) this.logger.log(`Expired ${expired} overdue booking hold(s)`);
    } catch (error) {
      this.logger.error(`Expiry job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }

  /** One sweep: up to 100 overdue holds, one transaction each. Returns how many this call expired. */
  async runOnce(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM bookings
      WHERE status = 'PENDING_PAYMENT' AND hold_expires_at <= ${now}
      ORDER BY hold_expires_at LIMIT ${BATCH}`;
    let expired = 0;
    for (const { id } of due) {
      if (await this.expireOne(id, true)) expired += 1;
    }
    return expired;
  }

  /**
   * Locks the booking and expires it if (still) overdue. With `skipLocked` (job) a booking another
   * transaction is working on is left to that transaction; otherwise (lazy path) we wait for it.
   * Whoever locks first wins; the loser re-reads the state, so CONFIRMED never follows EXPIRED (§2.3).
   */
  async expireOne(bookingId: string, skipLocked = false): Promise<boolean> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const rows = skipLocked
        ? await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM bookings
            WHERE id = ${bookingId}::uuid AND status = 'PENDING_PAYMENT' AND hold_expires_at <= ${now}
            FOR UPDATE SKIP LOCKED`
        : await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM bookings
            WHERE id = ${bookingId}::uuid AND status = 'PENDING_PAYMENT' AND hold_expires_at <= ${now}
            FOR UPDATE`;
      if (rows.length === 0) return false;
      const booking = await this.machine.load(tx, bookingId);
      if (!booking) return false;
      await this.machine.expire(tx, booking, 'HOLD_EXPIRED', SYSTEM);
      return true;
    }, TX_OPTIONS);
  }

  /** Lazy check before touching a student's or slot's bookings (a late job must not block others). */
  async expireDueFor(filter: { studentId?: string; slotId?: string; bookingId?: string }): Promise<void> {
    const due = await this.prisma.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { lte: this.clock.now() },
        ...(filter.studentId ? { studentId: filter.studentId } : {}),
        ...(filter.slotId ? { slotId: filter.slotId } : {}),
        ...(filter.bookingId ? { id: filter.bookingId } : {}),
      },
      select: { id: true },
      take: BATCH,
    });
    for (const { id } of due) await this.expireOne(id);
  }
}
