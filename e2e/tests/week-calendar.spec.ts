// QUA-58 §3: week calendar of "Lịch của tôi" (student) and "Buổi dạy" (tutor): week navigation and data that does not depend on the list tabs.
import type { Page } from '@playwright/test';
import type { Booking } from '../fixtures/api';
import { finishedLessonAt, paidBooking, weekOffset } from '../fixtures/earnings';
import { expect, test } from '../fixtures/test';
import { vnRange } from '../fixtures/ui';

const HOUR = 3_600_000;

/** Back to this week, then `weeks` steps away. Each step is pure client state: the calendar already holds every booking. */
async function goToWeek(page: Page, weeks: number): Promise<void> {
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  const step = page.getByRole('button', { name: weeks < 0 ? 'Tuần trước' : 'Tuần sau', exact: true });
  for (let i = 0; i < Math.abs(weeks); i++) await step.click();
}

const event = (page: Page, href: string) => page.locator(`a.week-event[href="${href}"]`);

test('lịch tuần: chuyển tuần quá khứ/hiện tại/tương lai, đủ mọi trạng thái, mở được chi tiết ở cả hai vai trò', async ({ pageAs, student, tutor, newSlot, db }) => {
  test.setTimeout(240_000);
  const deps = { newSlot, db };
  // past (already taught, "Đã qua" tab), soon (upcoming), later (upcoming, next-ish week), cancelled ("Đã huỷ" tab).
  const past = await finishedLessonAt(deps, student, tutor, new Date(Date.now() - (8 * 24 + 4) * HOUR - Math.floor(Math.random() * 3_600_000)));
  const soon = await paidBooking(deps, student, tutor, { inHours: 2 });
  const later = await paidBooking(deps, student, tutor, { inHours: 10 * 24 + 5 });
  const cancelled = await paidBooking(deps, student, tutor, { inHours: 72 });
  await student.post(`/bookings/${cancelled.id}/cancel`, {});
  expect((await student.booking(cancelled.id)).status).toBe('CANCELLED_BY_STUDENT');

  const cases: { name: string; booking: Booking; tag: RegExp }[] = [
    { name: 'đã qua', booking: past, tag: /Đã xác nhận/ },
    { name: 'sắp tới', booking: soon, tag: /Đã xác nhận/ },
    { name: 'tuần sau nữa', booking: later, tag: /Đã xác nhận/ },
    { name: 'đã huỷ', booking: cancelled, tag: /huỷ/ },
  ];
  // Weeks differ by the time the spec runs; the offsets are computed, never assumed.
  expect(weekOffset(past.startAt)).toBeLessThan(0);
  expect(weekOffset(later.startAt)).toBeGreaterThan(0);

  const views = [
    { role: 'student' as const, url: '/lich-cua-toi', href: (b: Booking) => `/lich-cua-toi/${b.id}` },
    { role: 'tutor' as const, url: '/gia-su/buoi-day', href: (b: Booking) => `/gia-su/buoi-day/${b.id}` },
  ];
  for (const view of views) {
    const page = await pageAs(view.role);
    await page.goto(view.url);
    await page.getByText('Lịch tuần', { exact: true }).click();
    await expect(page.getByRole('region', { name: 'Lịch tuần' })).toBeVisible();

    for (const c of cases) {
      const offset = weekOffset(c.booking.startAt);
      await goToWeek(page, offset);
      const card = event(page, view.href(c.booking));
      await expect(card, `${view.role}/${c.name}`).toBeVisible();
      await expect(card).toContainText(vnRange(c.booking.startAt, c.booking.endAt));
      await expect(card).toContainText(c.tag);
      // The neighbouring weeks must not show it.
      await goToWeek(page, offset + 1);
      await expect(event(page, view.href(c.booking))).toHaveCount(0);
      await goToWeek(page, offset - 1);
      await expect(event(page, view.href(c.booking))).toHaveCount(0);
    }

    // "Hôm nay" always returns to the current week.
    await goToWeek(page, 3);
    await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
    await expect(page.locator('.week-today')).toHaveCount(1);

    // Open the detail of a session from the calendar.
    await goToWeek(page, weekOffset(soon.startAt));
    await event(page, view.href(soon)).click();
    await expect(page).toHaveURL(new RegExp(`${view.href(soon)}$`));
    await expect(page.getByText(soon.code).first()).toBeVisible();
  }
});
