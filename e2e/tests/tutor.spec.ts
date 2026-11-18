// E2E-14..17 (docs/test-plan.md section 6.2): the tutor side - create a slot, receive a lesson, open it, see the review, stay out of admin.
import type { Page } from '@playwright/test';
import { ACCOUNTS } from '../fixtures/env';
import type { Slot } from '../fixtures/api';
import { expect, test } from '../fixtures/test';
import { confirmBooking, goToGateway, payAtGateway, vnRange, vnd } from '../fixtures/ui';

/** Step through the week grid until `target` is visible; each hop waits for its own data. */
async function revealByWeek(page: Page, target: ReturnType<Page['getByText']>): Promise<void> {
  const next = page.getByRole('button', { name: 'Tuần sau', exact: true });
  await expect(next).toBeVisible();
  for (let week = 0; week < 4; week++) {
    await expect(page.locator('.ant-skeleton')).toHaveCount(0);
    if (await target.isVisible()) return;
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/slots?') && r.request().method() === 'GET' && r.ok()),
      next.click(),
    ]);
  }
  await expect(page.locator('.ant-skeleton')).toHaveCount(0);
}

const vnParts = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

/** 7-13 days ahead on a random minute: clear of the 20+ day range the shared newSlot fixture uses. */
const nearStart = (): Date => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  const minuteOfDay = 6 * 60 + Math.floor(Math.random() * 15 * 60);
  return new Date(base.getTime() + (7 + Math.floor(Math.random() * 7)) * 86_400_000 + (minuteOfDay - 7 * 60) * 60_000);
};

test.describe('Luồng gia sư', () => {
  test('E2E-14 tạo khung giờ trống: hiện ở lịch của gia sư và trang công khai', async ({ pageAs, student, tutor }) => {
    const startAt = nearStart();
    const endAt = new Date(startAt.getTime() + 3_600_000);
    const { date, time } = vnParts(startAt);
    const range = vnRange(startAt.toISOString(), endAt.toISOString());
    const page = await pageAs('tutor');

    await page.goto('/gia-su/lich-trong');
    await page.getByRole('button', { name: 'Thêm khung giờ' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Ngày').fill(date);
    await dialog.getByLabel('Giờ bắt đầu').fill(time);
    await dialog.getByRole('button', { name: 'Thêm', exact: true }).click();
    await expect(page.getByText('Đã thêm khung giờ.')).toBeVisible();
    await expect(dialog).toBeHidden();

    const mine = await tutor.get<Slot[]>(`/tutor/slots?from=${encodeURIComponent(startAt.toISOString())}&to=${encodeURIComponent(endAt.toISOString())}`);
    expect(mine.find((s) => s.startAt === startAt.toISOString())?.status).toBe('AVAILABLE');

    await revealByWeek(page, page.getByText(range, { exact: true }).first());
    const card = page.locator('.ant-card-small', { hasText: range });
    await expect(card.getByText('Trống', { exact: true })).toBeVisible();

    // Public tutor page, as a student.
    const tutorId = (await student.get<{ items: { id: string; fullName: string }[] }>('/tutors')).items.find((x) => x.fullName === ACCOUNTS.tutor.fullName)!.id;
    const studentPage = await pageAs('student');
    await studentPage.goto(`/gia-su/${tutorId}`);
    await revealByWeek(studentPage, studentPage.getByRole('button', { name: new RegExp(range) }));
    await expect(studentPage.getByRole('button', { name: new RegExp(range) })).toBeVisible();
  });

  test('E2E-15 học viên đặt và thanh toán: gia sư thấy buổi học và mở được chi tiết', async ({ pageAs, student, tutor, newSlot }) => {
    const slot = await newSlot(tutor);
    const studentPage = await pageAs('student');
    const bookingId = await confirmBooking(studentPage, slot.id);
    await goToGateway(studentPage);
    await payAtGateway(studentPage, 'SUCCESS');
    await expect.poll(async () => (await student.booking(bookingId)).status, { timeout: 35_000 }).toBe('CONFIRMED');
    const booking = await student.booking(bookingId);
    const range = vnRange(slot.startAt, slot.endAt);

    const page = await pageAs('tutor');
    await page.goto('/gia-su/buoi-day');
    const row = page.locator('.ant-list-item', { hasText: range }).filter({ hasText: 'Lê Học Viên' });
    // Upcoming sessions are ordered by time; a far-future slot may sit on a later page.
    // The list swaps to a spinner (no pager) while a page loads, so wait for each page's rows before looking at the pager.
    await expect(page.locator('.ant-list-item').first()).toBeVisible();
    for (let i = 0; i < 30 && !(await row.first().isVisible()); i++) {
      const nextPage = page.locator('.ant-pagination-next');
      if ((await nextPage.getAttribute('aria-disabled')) === 'true') break;
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/tutor/bookings') && r.request().method() === 'GET' && r.ok()),
        nextPage.click(),
      ]);
      await expect(page.locator('.ant-list-item').first()).toBeVisible();
    }
    await expect(row.first()).toBeVisible();
    await expect(row.first().getByText('Đã xác nhận')).toBeVisible();
    await row.first().getByRole('button', { name: 'Chi tiết' }).click();

    await expect(page).toHaveURL(new RegExp(`/gia-su/buoi-day/${bookingId}$`));
    await expect(page.getByText('Lê Học Viên')).toBeVisible();
    await expect(page.getByText(booking.code)).toBeVisible();
    await expect(page.getByText(range).first()).toBeVisible();
    await expect(page.getByText(vnd(ACCOUNTS.tutor.priceVnd)).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Huỷ buổi dạy' })).toBeEnabled();
  });

  test('E2E-16 học viên đánh giá sau buổi học: gia sư thấy ở trang đánh giá', async ({ pageAs, student, confirmedBooking, db }) => {
    const booking = await confirmedBooking();
    await db.finishLesson(booking.id);
    const comment = `Dạy rất dễ hiểu ${booking.code}`;
    const studentPage = await pageAs('student');
    await studentPage.goto(`/lich-cua-toi/${booking.id}`);
    await studentPage.getByRole('button', { name: 'Đánh giá gia sư', exact: true }).click();
    const dialog = studentPage.getByRole('dialog');
    await dialog.getByRole('radio').nth(3).click(); // 4 stars
    await dialog.getByLabel('Nhận xét (không bắt buộc)').fill(comment);
    await dialog.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await student.booking(booking.id)).review).toMatchObject({ rating: 4, comment });

    const page = await pageAs('tutor');
    await page.goto('/gia-su/danh-gia');
    await expect(page.getByRole('heading', { name: 'Đánh giá nhận được' })).toBeVisible();
    const item = page.locator('.ant-list-item', { hasText: comment });
    await expect(item).toBeVisible();
    await expect(item).toContainText('Lê V.'); // the tutor sees the reviewer abbreviated
    await expect(item.getByRole('radio', { checked: true })).toHaveCount(0); // read-only stars, not a form
    await expect(item.locator('.ant-rate-star-full')).toHaveCount(4);
    await expect(page.getByText(/\(\d+ đánh giá\)/)).toBeVisible();
  });

  test('E2E-17 gia sư không vào được trang admin', async ({ pageAs, tutor }) => {
    const page = await pageAs('tutor');
    for (const path of ['/admin', '/admin/nguoi-dung', '/admin/booking']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/403$/);
      await expect(page.getByText('Bạn không có quyền truy cập trang này.')).toBeVisible();
    }
    for (const path of ['/admin/stats', '/admin/users', '/admin/bookings']) {
      expect((await tutor.send('get', path)).status).toBe(403);
    }
  });
});
