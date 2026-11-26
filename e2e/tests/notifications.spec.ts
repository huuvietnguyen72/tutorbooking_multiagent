// QUA-58 §5 (QUA-61): in-app notification centre. A paid booking notifies both the student and the tutor.
import type { Page } from '@playwright/test';
import type { Api, Booking } from '../fixtures/api';
import { paidBooking } from '../fixtures/earnings';
import { ACCOUNTS } from '../fixtures/env';
import { expect, test } from '../fixtures/test';

interface Notice { id: string; type: string; title: string; body: string; bookingId: string | null; isRead: boolean }
interface NoticePage { total: number; items: Notice[] }

const unread = async (api: Api): Promise<number> => (await api.get<{ count: number }>('/notifications/unread-count')).count;
const bell = (page: Page, count?: number) => page.getByRole('button', { name: count === undefined ? /^Thông báo/ : count === 0 ? 'Thông báo' : `Thông báo, ${count} chưa đọc` });
const panelRow = (page: Page, code: string) => page.locator('.ant-popover .ant-list-item', { hasText: code });

test('trung tâm thông báo: badge, nội dung/link, đánh dấu đọc 1 cái, đọc tất cả, và cách ly giữa người dùng', async ({ pageAs, student, student2, tutor, tutor2, newSlot }) => {
  test.setTimeout(240_000);
  // Clean slate for the three parties; student2 and tutor2 take no part in the bookings.
  for (const api of [student, tutor]) expect((await api.send('post', '/notifications/read-all')).status).toBe(200);
  const outsiders = [student2, tutor2];

  const bookings: Booking[] = [];
  for (let i = 0; i < 3; i++) bookings.push(await paidBooking({ newSlot }, student, tutor));
  const [a, b, c] = bookings;
  await expect.poll(() => unread(student), { timeout: 35_000 }).toBe(3);
  await expect.poll(() => unread(tutor), { timeout: 35_000 }).toBe(3);

  // API content: right type, tied to the booking, names the other party.
  const mine = await student.get<NoticePage>('/notifications?unreadOnly=true');
  for (const booking of bookings) {
    const n = mine.items.find((x) => x.bookingId === booking.id)!;
    expect(n).toMatchObject({ type: 'BOOKING_CONFIRMED', title: 'Đặt lịch đã được xác nhận', isRead: false });
    expect(n.body).toContain(booking.code);
    expect(n.body).toContain(ACCOUNTS.tutor.fullName);
  }

  // Isolation: nobody else sees these notices or any badge for them.
  for (const other of outsiders) {
    const list = await other.get<NoticePage>('/notifications?pageSize=100');
    expect(list.items.some((n) => bookings.some((x) => x.id === n.bookingId))).toBe(false);
  }
  const outsiderPage = await pageAs('student2');
  await outsiderPage.goto('/gia-su');
  await expect(bell(outsiderPage)).toBeVisible();
  await bell(outsiderPage).click();
  for (const booking of bookings) await expect(panelRow(outsiderPage, booking.code)).toHaveCount(0);

  // Tutor: badge, panel text, link to the session, and "read all" does not touch the student's count.
  const tutorPage = await pageAs('tutor');
  await tutorPage.goto('/gia-su/buoi-day');
  await expect(bell(tutorPage, 3)).toBeVisible();
  await bell(tutorPage, 3).click();
  const tutorRow = panelRow(tutorPage, a.code);
  await expect(tutorRow).toContainText('Đặt lịch đã được xác nhận');
  await expect(tutorRow).toContainText('Lê Học Viên');
  await expect(tutorRow).toContainText('Chưa đọc');
  await tutorRow.getByRole('button', { name: 'Xem chi tiết' }).click();
  await expect(tutorPage).toHaveURL(new RegExp(`/gia-su/buoi-day/${a.id}$`));
  await expect.poll(() => unread(tutor)).toBe(2);
  await bell(tutorPage, 2).click();
  await tutorPage.getByRole('button', { name: 'Đọc tất cả' }).click();
  await expect(bell(tutorPage, 0)).toBeVisible();
  expect(await unread(tutor)).toBe(0);
  expect(await unread(student)).toBe(3);

  // Student: badge shows 3; open one (goes to the booking, marks it read), mark one read in place, then read all.
  const page = await pageAs('student');
  await page.goto('/gia-su');
  await expect(bell(page, 3)).toBeVisible();
  await bell(page, 3).click();
  const rowA = panelRow(page, a.code);
  await expect(rowA).toContainText('Đặt lịch đã được xác nhận');
  await expect(rowA).toContainText(ACCOUNTS.tutor.fullName);
  await expect(rowA).toHaveAttribute('data-unread', 'true');
  await rowA.getByRole('button', { name: 'Xem chi tiết' }).click();
  await expect(page).toHaveURL(new RegExp(`/lich-cua-toi/${a.id}$`));
  await expect.poll(() => unread(student)).toBe(2);

  await expect(bell(page, 2)).toBeVisible();
  await bell(page, 2).click();
  await expect(panelRow(page, a.code)).toHaveAttribute('data-unread', 'false');
  await panelRow(page, b.code).getByRole('button', { name: /^Đánh dấu đã đọc/ }).click();
  await expect(panelRow(page, b.code)).toHaveAttribute('data-unread', 'false');
  await expect(panelRow(page, c.code)).toHaveAttribute('data-unread', 'true');
  await expect.poll(() => unread(student)).toBe(1);
  await expect(bell(page, 1)).toBeVisible();

  await page.getByRole('button', { name: 'Đọc tất cả' }).click();
  await expect(bell(page, 0)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đọc tất cả' })).toBeDisabled();
  for (const booking of bookings) await expect(panelRow(page, booking.code)).toHaveAttribute('data-unread', 'false');
  expect(await unread(student)).toBe(0);
  const stored = await student.get<NoticePage>('/notifications?pageSize=100');
  expect(stored.items.filter((n) => bookings.some((x) => x.id === n.bookingId)).every((n) => n.isRead)).toBe(true);
});

// QUA-152: at 375px the panel must sit fully inside the viewport (it used to start at x = -80).
for (const role of ['student', 'tutor'] as const) {
  test(`trung tâm thông báo: panel nằm gọn trong màn hình 375px (${role})`, async ({ pageAs }) => {
    const page = await pageAs(role);
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto('/gia-su');
    await bell(page).click();
    const panel = page.locator('.ant-drawer-content, .ant-popover').first();
    await expect(panel.getByText('Thông báo', { exact: true }).first()).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
