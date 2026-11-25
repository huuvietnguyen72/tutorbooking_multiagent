import { Pool } from 'pg';
import { databaseUrl } from './env';

/**
 * Time travel without a test-clock endpoint (test plan section 7, option 2): move the hold deadline into the past
 * and let the real lazy-expiry / job path decide. Only the compose test database is reachable here.
 */
export class Db {
  private readonly pool = new Pool({ connectionString: databaseUrl(), max: 2 });

  /** The seeded admin must change the password before using the API; the throwaway test database skips that step. */
  async clearMustChangePassword(email: string): Promise<void> {
    const res = await this.pool.query(`UPDATE users SET must_change_password = false WHERE email = $1 AND role = 'ADMIN'`, [email.toLowerCase()]);
    if (res.rowCount !== 1) throw new Error(`clearMustChangePassword: no admin ${email}`);
  }

  async expireHold(bookingId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
      [bookingId],
    );
    if (res.rowCount !== 1) throw new Error(`expireHold: booking ${bookingId} is not a live PENDING_PAYMENT hold`);
  }

  /** Move this paid lesson and its slot together into a unique past interval (PA2). */
  async finishLesson(bookingId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lesson = await client.query(
        `SELECT slot_id, start_at, end_at FROM bookings
         WHERE id = $1 AND status = 'CONFIRMED' FOR UPDATE`, [bookingId],
      );
      if (lesson.rowCount !== 1) throw new Error(`finishLesson: ${bookingId} is not CONFIRMED`);
      // Preserve the randomly allocated interval and duration, shifting it 800 days back.
      await client.query(
        `UPDATE slots SET start_at = start_at - interval '800 days', end_at = end_at - interval '800 days'
         WHERE id = $1`, [lesson.rows[0].slot_id],
      );
      await client.query(
        `UPDATE bookings SET start_at = start_at - interval '800 days', end_at = end_at - interval '800 days'
         WHERE id = $1`, [bookingId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Move a paid lesson and its slot to `startAt`, keeping the duration (earnings are reported by the month the lesson
   * ended in). A failed earlier attempt can leave a slot in that month, so walk forward in 70-minute steps (longer
   * than a lesson) until the interval is free instead of colliding with `slots_no_overlap`.
   */
  async moveLesson(bookingId: string, startAt: Date): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await this.tryMoveLesson(bookingId, new Date(startAt.getTime() + attempt * 70 * 60_000));
        return;
      } catch (error) {
        // 23P01 = exclusion_violation: the target interval overlaps another slot of the same tutor.
        if ((error as { code?: string } | null)?.code !== '23P01') throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private async tryMoveLesson(bookingId: string, startAt: Date): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lesson = await client.query(
        `SELECT slot_id, start_at, end_at FROM bookings WHERE id = $1 AND status = 'CONFIRMED' FOR UPDATE`, [bookingId],
      );
      if (lesson.rowCount !== 1) throw new Error(`moveLesson: ${bookingId} is not CONFIRMED`);
      const { slot_id: slotId, start_at: from, end_at: to } = lesson.rows[0] as { slot_id: string; start_at: Date; end_at: Date };
      const endAt = new Date(startAt.getTime() + (to.getTime() - from.getTime()));
      await client.query(`UPDATE slots SET start_at = $2, end_at = $3 WHERE id = $1`, [slotId, startAt.toISOString(), endAt.toISOString()]);
      await client.query(`UPDATE bookings SET start_at = $2, end_at = $3 WHERE id = $1`, [bookingId, startAt.toISOString(), endAt.toISOString()]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
