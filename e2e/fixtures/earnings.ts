import { expect, type Page } from '@playwright/test';
import { paymentIdOf, type Api, type Booking, type Slot } from './api';
import type { Db } from './db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VN_OFFSET = 7 * HOUR;

/** `YYYY-MM` of a calendar month in Asia/Ho_Chi_Minh, `offset` months from the current one (0 = this month, -1 = last month). */
export function vnMonth(offset: number): string {
  const now = new Date(Date.now() + VN_OFFSET);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `MM/YYYY`, as the UI prints a month. */
export const monthLabel = (month: string): string => `${month.slice(5)}/${month.slice(0, 4)}`;

/** A lesson start inside a finished month (VN time): day 1 + `index`, a random hour 8-18 and minute. Distinct indexes never overlap. */
export function lessonStartIn(offset: number, index: number): Date {
  const [y, m] = vnMonth(offset).split('-').map(Number);
  const monthStart = Date.UTC(y, m - 1, 1) - VN_OFFSET;
  return new Date(monthStart + (index % 27) * DAY + (8 + Math.floor(Math.random() * 11)) * HOUR + Math.floor(Math.random() * 60) * 60_000);
}

/** Week index with weeks starting on Monday, in VN time (1970-01-01 was a Thursday). */
const weekIndex = (t: number): number => Math.floor((Math.floor((t + VN_OFFSET) / DAY) + 3) / 7);

/** How many weeks `target` is from the current week (negative = past). */
export const weekOffset = (target: Date | string): number => weekIndex(new Date(target).getTime()) - weekIndex(Date.now());

export interface LessonDeps {
  newSlot: (owner?: Api, opts?: { inHours?: number; startAt?: Date }) => Promise<Slot>;
  db: Db;
}

/** Hold + pay through the API (precondition only). The caller decides the time. */
export async function paidBooking(deps: Pick<LessonDeps, 'newSlot'>, booker: Api, owner: Api, opts?: { inHours?: number }): Promise<Booking> {
  const slot = await deps.newSlot(owner, opts);
  const { booking, checkoutUrl } = await booker.createBooking(slot.id);
  await booker.completePayment(paymentIdOf(checkoutUrl), 'SUCCESS');
  await expect.poll(async () => (await booker.booking(booking.id)).status, { timeout: 35_000 }).toBe('CONFIRMED');
  return booker.booking(booking.id);
}

/** A paid lesson that already took place at `startAt` (moved there in the database, as `finishLesson` does). */
export async function finishedLessonAt(deps: LessonDeps, booker: Api, owner: Api, startAt: Date): Promise<Booking> {
  const booking = await paidBooking(deps, booker, owner);
  await deps.db.moveLesson(booking.id, startAt);
  return booker.booking(booking.id);
}

/** Read the number out of an antd Statistic by its title (strips currency symbol and separators). */
export async function statValue(page: Page, title: string): Promise<number> {
  const stat = page.locator('.ant-statistic', { has: page.locator('.ant-statistic-title', { hasText: new RegExp(`^${title}$`) }) });
  const text = (await stat.locator('.ant-statistic-content').first().textContent()) ?? '';
  return Number(text.replace(/\D/g, ''));
}

export interface EarningsSummary {
  month: string;
  isEmpty: boolean;
  sessionCount: number;
  grossVnd: number;
  platformFeeVnd: number;
  netVnd: number;
  settledNetVnd: number;
  unsettledNetVnd: number;
}

export interface EarningItems {
  total: number;
  items: { code: string; priceVnd: number; platformFeeVnd: number; netVnd: number; settled: boolean }[];
}

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
