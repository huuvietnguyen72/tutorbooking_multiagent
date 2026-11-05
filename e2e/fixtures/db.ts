import { Pool } from 'pg';
import { databaseUrl } from './env';

/**
 * Time travel without a test-clock endpoint (test plan section 7, option 2): move the hold deadline into the past
 * and let the real lazy-expiry / job path decide. Only the compose test database is reachable here.
 */
export class Db {
  private readonly pool = new Pool({ connectionString: databaseUrl(), max: 2 });

  async expireHold(bookingId: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
      [bookingId],
    );
    if (res.rowCount !== 1) throw new Error(`expireHold: booking ${bookingId} is not a live PENDING_PAYMENT hold`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
