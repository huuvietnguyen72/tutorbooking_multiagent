// E2E-01..05 and E2E-10 (docs/test-plan.md section 6.2): pay, fail, hold expiry, late payment, resume, untrusted result URL.
import { ACCOUNTS } from '../fixtures/env';
import { expectNoMail, waitForMails } from '../fixtures/mailpit';
import { expect, test } from '../fixtures/test';
import { confirmBooking, goToGateway, holdSeconds, payAtGateway, vnRange, vnd } from '../fixtures/ui';

test.describe('Đặt lịch và thanh toán', () => {
  test('E2E-01 thanh toán thành công: tìm gia sư, đặt, trả tiền, 2 email', async ({ pageAs, student, tutor, newSlot }) => {
    const slot = await newSlot(tutor, { inHours: 50 });
    const page = await pageAs('student');

    await page.goto('/gia-su');
    await page
      .locator('.ant-card', { has: page.getByRole('heading', { name: ACCOUNTS.tutor.fullName }) })
      .last()
      .getByRole('link', { name: 'Xem hồ sơ' })
      .click();
    const slotButton = page.getByRole('button', { name: new RegExp(vnRange(slot.startAt, slot.endAt)) });
    for (let week = 0; week < 3 && !(await slotButton.isVisible()); week++) {
      await page.getByRole('button', { name: 'Tuần sau' }).click();
      await page.waitForTimeout(300); // week switch refetches the grid; nothing else to await on
    }
    await slotButton.click();

    await expect(page.getByText(vnd(ACCOUNTS.tutor.priceVnd)).first()).toBeVisible(); // S-06 fee
    await page.getByRole('button', { name: 'Xác nhận & thanh toán' }).click();
    await page.waitForURL(/\/thanh-toan\/[0-9a-f-]{36}$/); // S-07
    const bookingId = /thanh-toan\/([0-9a-f-]{36})/.exec(page.url())![1];
    await expect(page.getByTestId('hold-countdown')).toBeVisible();
    await expect(page.getByText(vnd(ACCOUNTS.tutor.priceVnd)).first()).toBeVisible();
    expect(await holdSeconds(page)).toBeGreaterThan(14 * 60);

    await goToGateway(page); // S-08
    const code = (await student.booking(bookingId)).code;
    await expect(page.getByText(code)).toBeVisible();
    await payAtGateway(page, 'SUCCESS');

    await expect(page.getByText('Đặt lịch thành công!')).toBeVisible(); // S-09
    await expect.poll(async () => (await student.booking(bookingId)).status, { timeout: 35_000 }).toBe('CONFIRMED');
    const paid = await student.booking(bookingId);
    expect(paid.payment.status).toBe('PAID');

    await page.goto('/lich-cua-toi');
    await expect(page.getByText('Đã xác nhận')).toBeVisible();
    await expect(page.getByText(vnRange(slot.startAt, slot.endAt)).first()).toBeVisible();

    const mails = await waitForMails(code, 'thành công', 2);
    expect(mails.flatMap((m) => m.To.map((t) => t.Address)).sort()).toEqual([ACCOUNTS.student.email, ACCOUNTS.tutor.email].sort());
    for (const mail of mails) {
      expect(mail.Text).toContain(code);
      expect(mail.Text).toContain('(GMT+7)');
      expect(mail.Text).toMatch(vnd(ACCOUNTS.tutor.priceVnd));
    }

    // The slot is gone from the public grid.
    const tutorId = (await student.get<{ items: { id: string; fullName: string }[] }>('/tutors')).items.find((x) => x.fullName === ACCOUNTS.tutor.fullName)!.id;
    const from = new Date(Date.parse(slot.startAt) - 3_600_000).toISOString();
    const to = new Date(Date.parse(slot.endAt) + 3_600_000).toISOString();
    const open = await student.get<{ id: string; status: string }[]>(`/tutors/${tutorId}/slots?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    expect(open.find((s) => s.id === slot.id)?.status ?? 'UNAVAILABLE').not.toBe('AVAILABLE');
  });

  test('E2E-02 thanh toán thất bại: slot mở lại, đặt lại được', async ({ pageAs, student, student2, tutor, newSlot }) => {
    const slot = await newSlot(tutor);
    const page = await pageAs('student');
    const bookingId = await confirmBooking(page, slot.id);
    await goToGateway(page);
    await payAtGateway(page, 'FAILURE');

    await expect(page.getByText('Thanh toán không thành công')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Đặt lại khung giờ này' })).toBeVisible();

    await expect.poll(async () => (await student.booking(bookingId)).status).toBe('EXPIRED');
    const failed = await student.booking(bookingId);
    expect(failed.payment.status).toBe('FAILED');

    const code = failed.code;
    await expectNoMail(code, 'thành công');

    // Another student can take the released slot straight away.
    const { booking } = await student2.createBooking(slot.id);
    await student2.post(`/bookings/${booking.id}/cancel`, {});

    await page.getByRole('link', { name: 'Đặt lại khung giờ này' }).click();
    await expect(page.getByRole('heading', { name: 'Xác nhận đặt lịch' })).toBeVisible();
  });

  test('E2E-03 hết hạn 15 phút: không thể trả, slot nhả', async ({ pageAs, student, student2, tutor, db, newSlot }) => {
    const slot = await newSlot(tutor);
    const page = await pageAs('student');
    const bookingId = await confirmBooking(page, slot.id);
    await expect(page.getByTestId('hold-countdown')).toBeVisible();

    await db.expireHold(bookingId); // test plan section 7, option 2
    await page.reload(); // GET /bookings/{id} lazily expires the overdue hold

    await expect(page.getByText('Đã hết thời gian giữ chỗ')).toBeVisible();
    const expired = await student.booking(bookingId);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.payment.status).toBe('FAILED');
    await expectNoMail(expired.code, 'thành công');

    const { booking } = await student2.createBooking(slot.id);
    await student2.post(`/bookings/${booking.id}/cancel`, {});
  });

  test('E2E-04 tiền đến muộn: booking vẫn hết hạn, tự hoàn tiền', async ({ pageAs, student, tutor, db, newSlot }) => {
    const slot = await newSlot(tutor);
    const page = await pageAs('student');
    const bookingId = await confirmBooking(page, slot.id);
    await goToGateway(page);

    await db.expireHold(bookingId);
    await page.reload();
    await expect(page.getByText(/Đặt chỗ đã hết hạn giữ/)).toBeVisible(); // gateway still lets the shopper pay
    await payAtGateway(page, 'SUCCESS');

    await expect.poll(async () => (await student.booking(bookingId)).payment.status, { timeout: 35_000 }).toBe('REFUNDED');
    const after = await student.booking(bookingId);
    expect(after.status).toBe('EXPIRED');
    await page.reload();
    await expect(page.getByText('Khoản thanh toán đã được tự động hoàn lại.')).toBeVisible();
    await expectNoMail(after.code, 'thành công');
  });

  test('E2E-05 countdown theo giờ server và tiếp tục thanh toán', async ({ pageAs, student, tutor, db, newSlot }) => {
    const slot = await newSlot(tutor);
    const { booking } = await student.createBooking(slot.id);
    const page = await pageAs('student');

    // Come back from "Lịch của tôi" to the pending booking.
    await page.goto('/lich-cua-toi');
    await page.getByRole('link', { name: 'Thanh toán' }).first().click();
    await page.waitForURL(new RegExp(`/thanh-toan/${booking.id}$`));
    const left = await holdSeconds(page);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(15 * 60);

    // The countdown follows the server, not the browser clock.
    await page.addInitScript(() => {
      const Real = Date;
      const skew = -3 * 3_600_000; // the browser clock is 3 hours behind
      class Skewed extends Real {
        constructor(...args: unknown[]) {
          super(...((args.length ? args : [Real.now() + skew]) as [number]));
        }
        static now(): number {
          return Real.now() + skew;
        }
      }
      window.Date = Skewed as DateConstructor;
    });
    await page.reload();
    const skewed = await holdSeconds(page);
    expect(Math.abs(skewed - left)).toBeLessThan(10);

    await db.expireHold(booking.id);
    const resume = await student.send('post', `/bookings/${booking.id}/checkout`, {});
    expect(resume.status).toBeGreaterThanOrEqual(400);
    await page.reload();
    await expect(page.getByText('Đã hết thời gian giữ chỗ')).toBeVisible();
  });

  test('E2E-10 trang kết quả không tin query string', async ({ pageAs, student, tutor, newSlot }) => {
    const slot = await newSlot(tutor);
    const { booking } = await student.createBooking(slot.id);
    const page = await pageAs('student');

    await page.goto(`/thanh-toan/${booking.id}/ket-qua?status=success&result=SUCCESS`);
    await expect(page.getByText('Đang xác nhận thanh toán…')).toBeVisible();
    await expect(page.getByText('Đặt lịch thành công!')).toHaveCount(0);
    await student.post(`/bookings/${booking.id}/cancel`, {});
  });
});
