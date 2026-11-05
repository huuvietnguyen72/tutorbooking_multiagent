import { expect, type Page } from '@playwright/test';

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', ...opts }).format(new Date(iso));

/** `19:00–20:00` in GMT+7, as the slot buttons and booking pages print it. */
export function vnRange(startIso: string, endIso: string): string {
  const t = (iso: string) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  return `${t(startIso)}–${t(endIso)}`;
}

/** Matches "200.000" however the browser groups digits. */
export const vnd = (amount: number): RegExp => new RegExp(String(amount).replace(/(\d)(?=(\d{3})+$)/g, '$1[.,\\s\\u00a0]?'));

export const bookingIdFrom = (url: string): string => /\/thanh-toan\/([0-9a-f-]{36})/.exec(url)?.[1] ?? '';

/** S-06: confirm the slot; lands on S-07 and returns the new booking id. */
export async function confirmBooking(page: Page, slotId: string): Promise<string> {
  await page.goto(`/dat-lich/${slotId}`);
  await page.getByRole('button', { name: 'Xác nhận & thanh toán' }).click();
  await page.waitForURL(/\/thanh-toan\/[0-9a-f-]{36}$/);
  return bookingIdFrom(page.url());
}

/** S-07 -> S-08 */
export async function goToGateway(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Thanh toán ngay' }).click();
  await page.waitForURL(/\/cong-thanh-toan-gia-lap\/[0-9a-f-]{36}$/);
}

export async function payAtGateway(page: Page, result: 'SUCCESS' | 'FAILURE'): Promise<void> {
  await page.getByRole('button', { name: result === 'SUCCESS' ? 'Thanh toán thành công' : 'Thanh toán thất bại' }).click();
  await page.waitForURL(/\/thanh-toan\/[0-9a-f-]{36}\/ket-qua/);
}

/** The countdown on S-07 as seconds. */
export async function holdSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('hold-countdown').textContent()) ?? '';
  const [m, s] = text.split(':').map(Number);
  expect(Number.isFinite(m) && Number.isFinite(s), `countdown "${text}"`).toBe(true);
  return m * 60 + s;
}
