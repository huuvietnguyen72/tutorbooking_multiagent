/* eslint-disable no-empty-pattern -- Playwright fixtures must destructure their dependencies, even when empty. */
import { expect, test as base, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Api, paymentIdOf, type Booking, type Slot } from './api';
import { Db } from './db';
import { STUDENT2_FILE, stateFile, type Role } from './paths';

interface Fixtures {
  rateLimitWindow: void;
  student: Api;
  student2: Api;
  tutor: Api;
  tutor2: Api;
  db: Db;
  /** Create a unique future slot for a tutor (retries on SLOT_OVERLAP). */
  newSlot: (owner?: Api, opts?: { inHours?: number; startAt?: Date }) => Promise<Slot>;
  /** Hold + pay through the API (precondition only; the UI does the part under test). */
  confirmedBooking: (opts?: { inHours?: number; owner?: Api }) => Promise<Booking>;
  /** Browser page logged in as a given role. */
  pageAs: (role: Role) => Promise<Page>;
}

const clients = async (role: Role) => Api.fromState(stateFile(role));

/** A start time in the display timezone that no other test or earlier run used: random day 20-400 ahead, on a random minute. */
function randomStart(): Date {
  const day = 20 + Math.floor(Math.random() * 380);
  const minuteOfDay = 6 * 60 + Math.floor(Math.random() * (15 * 60));
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  return new Date(base.getTime() + day * 86_400_000 + (minuteOfDay - 7 * 60) * 60_000);
}

export const test = base.extend<Fixtures>({
  // Each case shares the seeded student's 10/min booking and gateway budgets.
  // Wait for the real production window; do not disable or clear the limiter.
  rateLimitWindow: [async ({}, use) => {
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    await use();
  }, { auto: true, timeout: 70_000 }],

  student: async ({}, use) => { const a = await clients('student'); await use(a); await a.dispose(); },
  student2: async ({}, use) => { const a = await clients('student2'); await use(a); await a.dispose(); },
  tutor: async ({}, use) => { const a = await clients('tutor'); await use(a); await a.dispose(); },
  tutor2: async ({}, use) => { const a = await clients('tutor2'); await use(a); await a.dispose(); },
  db: async ({}, use) => { const d = new Db(); await use(d); await d.close(); },

  newSlot: async ({ tutor }, use) => {
    await use(async (owner = tutor, opts = {}) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const startAt = opts.startAt ?? (opts.inHours === undefined ? randomStart() : new Date(Date.now() + opts.inHours * 3_600_000 - attempt * 61 * 60_000));
        const res = await owner.send<Slot[]>('post', '/tutor/slots', { startTimes: [startAt.toISOString()] });
        if (res.status === 201) return res.body[0];
        if (res.status !== 409) throw new Error(`createSlot -> ${res.status} ${JSON.stringify(res.body)}`);
      }
      throw new Error('createSlot: could not find a free time after 5 attempts');
    });
  },

  confirmedBooking: async ({ student, tutor, newSlot }, use) => {
    await use(async (opts = {}) => {
      const slot = await newSlot(opts.owner ?? tutor, { inHours: opts.inHours });
      const { booking, checkoutUrl } = await student.createBooking(slot.id);
      await student.completePayment(paymentIdOf(checkoutUrl), 'SUCCESS');
      await expect.poll(async () => (await student.booking(booking.id)).status, { timeout: 35_000 }).toBe('CONFIRMED');
      return student.booking(booking.id);
    });
  },

  pageAs: async ({ browser }, use) => {
    const contexts: { close(): Promise<void> }[] = [];
    await use(async (role) => {
      const context = await browser.newContext({ storageState: stateFile(role), locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect };
export const student2Email = (): string => (JSON.parse(readFileSync(STUDENT2_FILE, 'utf8')) as { email: string }).email;
