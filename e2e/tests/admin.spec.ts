// E2E-14/15 (docs/test-plan.md section 6.2): admin cancellation and manual refund through the admin UI (S-28).
import { ACCOUNTS } from '../fixtures/env';
import { waitForMails } from '../fixtures/mailpit';
import { expect, test } from '../fixtures/test';

test.describe('Quản trị: huỷ booking và hoàn tiền thủ công', () => {
  test('E2E-14 admin huỷ booking kèm hoàn 100%: slot đóng, học viên thấy đã hoàn, có email', async ({ pageAs, student, tutor, confirmedBooking }) => {
    const booking = await confirmedBooking({ inHours: 72 });
    const page = await pageAs('admin');

    await page.goto(`/admin/booking/${booking.id}`);
    await page.getByRole('button', { name: /Huỷ & hoàn tiền/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Hoàn 100% cho học viên' }).check();
    // Reason is mandatory.
    await dialog.getByRole('button', { name: 'Xác nhận huỷ' }).click();
    await expect(dialog.getByText(/Vui lòng nhập lý do/)).toBeVisible();
    await dialog.locator('#admin-reason').fill('Sự cố hệ thống phòng học (E2E)');
    await dialog.getByRole('button', { name: 'Xác nhận huỷ' }).click();
    await expect(page.getByText('Đã huỷ booking.')).toBeVisible();

    expect((await student.booking(booking.id)).status).toBe('CANCELLED_BY_ADMIN');
    await expect.poll(async () => (await student.booking(booking.id)).payment.status, { timeout: 35_000 }).toBe('REFUNDED');

    const slots = await tutor.get<{ id: string; status: string }[]>(
      `/tutor/slots?from=${encodeURIComponent(new Date(Date.parse(booking.startAt) - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(booking.endAt) + 3_600_000).toISOString())}`,
    );
    expect(slots.find((s) => s.id === booking.slotId)?.status).toBe('CLOSED');

    const studentPage = await pageAs('student');
    await studentPage.goto(`/lich-cua-toi/${booking.id}`);
    await expect(studentPage.getByText('Đã huỷ bởi quản trị viên.')).toBeVisible();
    await expect(studentPage.getByText(/Đã hoàn .*giả lập/)).toBeVisible();

    const mails = await waitForMails(booking.code, 'đã bị huỷ', 2);
    expect(mails.flatMap((m) => m.To.map((t) => t.Address))).toContain(ACCOUNTS.student.email);
  });

  test('E2E-15 huỷ không hoàn, sau đó hoàn tiền thủ công: payment PAID -> REFUNDED, ghi nhận người hoàn', async ({ pageAs, student, confirmedBooking }) => {
    const booking = await confirmedBooking({ inHours: 72 });
    const page = await pageAs('admin');

    await page.goto(`/admin/booking/${booking.id}`);
    await page.getByRole('button', { name: /Huỷ & hoàn tiền/ }).click();
    const cancel = page.getByRole('dialog');
    await cancel.getByRole('radio', { name: 'Không hoàn tiền' }).check();
    await cancel.locator('#admin-reason').fill('Học viên vi phạm quy định (E2E)');
    await cancel.getByRole('button', { name: 'Xác nhận huỷ' }).click();
    await expect(page.getByText('Đã huỷ booking.')).toBeVisible();

    // No refund was requested: the money stays PAID until the manual refund.
    const held = await student.booking(booking.id);
    expect(held.status).toBe('CANCELLED_BY_ADMIN');
    expect(held.payment.status).toBe('PAID');

    await page.getByRole('button', { name: 'Hoàn tiền thủ công' }).click();
    const refund = page.getByRole('dialog');
    await refund.locator('#admin-reason').fill('Hoàn theo thoả thuận với học viên (E2E)');
    await refund.getByRole('button', { name: 'Hoàn tiền', exact: true }).click();
    await expect(page.getByText('Đã hoàn tiền.')).toBeVisible();

    await expect.poll(async () => (await student.booking(booking.id)).payment.status).toBe('REFUNDED');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Hoàn tiền thủ công' })).toHaveCount(0);
    await expect(page.getByText(/Đã hoàn tiền lúc/).first()).toBeVisible();
  });
});
