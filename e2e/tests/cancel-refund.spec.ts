// E2E-06..08 and E2E-11, E2E-13 (docs/test-plan.md section 6.2): cancellation, refund, tutor cancel, overlap, internal webhook.
import { request } from '@playwright/test';
import { ACCOUNTS, WEB_BASE_URL } from '../fixtures/env';
import { waitForMails } from '../fixtures/mailpit';
import { expect, test } from '../fixtures/test';
import { vnRange } from '../fixtures/ui';

test.describe('Huỷ, hoàn tiền và các ca biên', () => {
  test('E2E-06 học viên huỷ trước 24 giờ: hoàn 100%, slot mở lại, 2 email', async ({ pageAs, student, tutor, confirmedBooking }) => {
    const booking = await confirmedBooking();
    const page = await pageAs('student');

    await page.goto(`/lich-cua-toi/${booking.id}`);
    await page.getByRole('button', { name: 'Huỷ buổi học' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('hoàn 100% học phí');
    await dialog.getByRole('button', { name: 'Xác nhận huỷ' }).click();

    await expect(page.getByText('Đã huỷ bởi bạn.')).toBeVisible();
    await expect.poll(async () => (await student.booking(booking.id)).payment.status, { timeout: 35_000 }).toBe('REFUNDED');
    expect((await student.booking(booking.id)).status).toBe('CANCELLED_BY_STUDENT');
    await page.reload();
    await expect(page.getByText(/Đã hoàn .*giả lập/)).toBeVisible();

    const mails = await waitForMails(booking.code, 'đã bị huỷ', 2);
    expect(mails.flatMap((m) => m.To.map((t) => t.Address)).sort()).toEqual([ACCOUNTS.student.email, ACCOUNTS.tutor.email].sort());
    for (const mail of mails) expect(mail.Text).toContain(booking.code);

    // Slot is bookable again.
    const slots = await tutor.get<{ id: string; status: string }[]>(
      `/tutor/slots?from=${encodeURIComponent(new Date(Date.parse(booking.startAt) - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(booking.endAt) + 3_600_000).toISOString())}`,
    );
    expect(slots.find((s) => s.id === booking.slotId)?.status).toBe('AVAILABLE');
  });

  test('E2E-07 huỷ trong vòng 24 giờ bị chặn', async ({ pageAs, student, confirmedBooking }) => {
    const booking = await confirmedBooking({ inHours: 23 });
    const page = await pageAs('student');

    await page.goto(`/lich-cua-toi/${booking.id}`);
    await expect(page.getByRole('button', { name: 'Huỷ buổi học' })).toBeDisabled();
    await expect(page.getByText(/Không thể huỷ hoặc đổi lịch khi còn dưới 24 giờ/)).toBeVisible();

    const direct = await student.send<{ error: { code: string } }>('post', `/bookings/${booking.id}/cancel`, {});
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe('WINDOW_PASSED');
    const after = await student.booking(booking.id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.payment.status).toBe('PAID');
  });

  test('E2E-08 gia sư huỷ: học viên được hoàn 100%, slot đóng, có email', async ({ pageAs, student, tutor, confirmedBooking }) => {
    const booking = await confirmedBooking({ inHours: 72 });
    const page = await pageAs('tutor');

    await page.goto(`/gia-su/buoi-day/${booking.id}`);
    await page.getByRole('button', { name: 'Huỷ buổi dạy' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Lý do/).fill('Bận việc đột xuất (E2E)');
    await dialog.getByRole('button', { name: 'Xác nhận huỷ' }).click();
    await expect(page.getByText('Đã huỷ buổi dạy.')).toBeVisible();

    await expect.poll(async () => (await student.booking(booking.id)).status).toBe('CANCELLED_BY_TUTOR');
    await expect.poll(async () => (await student.booking(booking.id)).payment.status, { timeout: 35_000 }).toBe('REFUNDED');

    const slots = await tutor.get<{ id: string; status: string }[]>(
      `/tutor/slots?from=${encodeURIComponent(new Date(Date.parse(booking.startAt) - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(booking.endAt) + 3_600_000).toISOString())}`,
    );
    expect(slots.find((s) => s.id === booking.slotId)?.status).toBe('CLOSED');

    const studentPage = await pageAs('student');
    await studentPage.goto(`/lich-cua-toi/${booking.id}`);
    await expect(studentPage.getByText('Đã huỷ bởi gia sư.')).toBeVisible();
    await expect(studentPage.getByText(/Đã hoàn .*giả lập/)).toBeVisible();

    const mails = await waitForMails(booking.code, 'đã bị huỷ', 2);
    expect(mails.map((m) => m.Text).join('\n')).toContain('Bận việc đột xuất (E2E)');
  });

  test('E2E-11 chống trùng lịch: báo lỗi kèm giờ trùng', async ({ pageAs, tutor2, confirmedBooking, newSlot }) => {
    const first = await confirmedBooking();
    const clash = await newSlot(tutor2, { startAt: new Date(first.startAt) });
    const page = await pageAs('student');

    await page.goto(`/dat-lich/${clash.id}`);
    await page.getByRole('button', { name: 'Xác nhận & thanh toán' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Bạn đã có buổi học trùng giờ này');
    await expect(alert).toContainText(vnRange(first.startAt, first.endAt));
    await expect(page).toHaveURL(/\/dat-lich\//);
  });

  test('E2E-13 webhook thanh toán không truy cập được từ ngoài', async ({ student, tutor, newSlot }) => {
    const slot = await newSlot(tutor);
    const { booking } = await student.createBooking(slot.id);
    const outside = await request.newContext({ baseURL: WEB_BASE_URL });
    for (const path of ['/api/v1/payments/webhooks/mock', '/api/v1/payments/webhooks/mock/']) {
      const res = await outside.post(path, { data: { event: 'payment.succeeded' }, headers: { 'x-mock-signature': 'sha256=00' } });
      expect(res.status(), path).toBe(404);
    }
    await outside.dispose();
    expect((await student.booking(booking.id)).status).toBe('PENDING_PAYMENT');
    await student.post(`/bookings/${booking.id}/cancel`, {});
  });
});

