import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock';
import { APP_ENV } from '../common/config';
import { PrismaService } from '../common/prisma.service';
import type { Env } from '../config/env';
import { MailTransport } from './mail-transport';
import { renderMail, UnknownTemplateError } from './templates/vi';

const BATCH = 20;
export const MAX_ATTEMPTS = 5;
/** Delay before retry n (1-based): 1, 5, 15, 15 minutes; the 5th failure is final (§2.6). */
export const BACKOFF_MINUTES = [1, 5, 15, 15] as const;
/** A claimed row is invisible to other workers for this long; covers a crash between claim and result. */
const LEASE_MS = 5 * 60_000;

interface Claimed {
  id: string;
  toEmail: string;
  template: string;
  payload: unknown;
  attempts: number;
}

/**
 * Transactional-outbox consumer (§2.6). Business code inserts `email_outbox` rows in its own
 * transaction; this worker ships them after commit, so a mail failure can never roll a booking back.
 */
@Injectable()
export class MailOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailOutboxWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly transport: MailTransport,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.MAIL_WORKER_INTERVAL_SECONDS === 0) return;
    this.timer = setInterval(() => void this.tick(), this.env.MAIL_WORKER_INTERVAL_SECONDS * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`Outbox sweep failed: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }

  /** One sweep over due rows. Returns how many mails were delivered. */
  async runOnce(): Promise<number> {
    let sent = 0;
    for (const row of await this.claim()) {
      if (await this.deliver(row)) sent += 1;
    }
    return sent;
  }

  /** Claims due rows with SKIP LOCKED and pushes their retry time out, so parallel workers never double-send. */
  private claim(): Promise<Claimed[]> {
    const now = this.clock.now();
    const lease = new Date(now.getTime() + LEASE_MS);
    return this.prisma.$queryRaw<Claimed[]>`
      UPDATE email_outbox SET next_attempt_at = ${lease}
      WHERE id IN (
        SELECT id FROM email_outbox
        WHERE status = 'PENDING' AND next_attempt_at <= ${now}
        ORDER BY next_attempt_at, created_at
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, to_email AS "toEmail", template, payload, attempts`;
  }

  private async deliver(row: Claimed): Promise<boolean> {
    const now = this.clock.now();
    try {
      const mail = renderMail(row.template, row.payload, this.env.DISPLAY_TIMEZONE);
      await this.transport.send({ to: row.toEmail, ...mail });
      await this.prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: now, attempts: row.attempts + 1, lastError: null },
      });
      return true;
    } catch (error) {
      const attempts = row.attempts + 1;
      const permanent = error instanceof UnknownTemplateError || attempts >= MAX_ATTEMPTS;
      const message = (error instanceof Error ? error.message : 'unknown error').slice(0, 500);
      await this.prisma.emailOutbox.update({
        where: { id: row.id },
        data: permanent
          ? { status: 'FAILED', attempts, lastError: message }
          : { attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + BACKOFF_MINUTES[attempts - 1] * 60_000) },
      });
      this.logger.warn(`Email ${row.id} (${row.template}) attempt ${attempts} failed: ${message}`);
      return false;
    }
  }
}
