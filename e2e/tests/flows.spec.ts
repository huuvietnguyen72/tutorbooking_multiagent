import { ACCOUNTS } from '../fixtures/env';
import { waitForMails } from '../fixtures/mailpit';
import { expect, test } from '../fixtures/test';
import { vnRange } from '../fixtures/ui';

test('E2E-09 đổi lịch một lần: giờ mới, slot cũ mở lại và email hai bên', async ({ pageAs, student, tutor, confirmedBooking, newSlot }) => {
  const booking = await confirmedBooking({ inHours: 50 });
  const target = await newSlot(tutor, { inHours: 76 });
  const page = await pageAs('student');
  await page.goto(`/lich-cua-toi/${booking.id}`);
  await page.getByRole('link', { name: 'Đổi lịch', exact: true }).click();
  const slotButton = page.getByRole('button', { name: new RegExp(vnRange(target.startAt, target.endAt)) });
  for (let week = 0; week < 3 && !(await slotButton.isVisible()); week++) {
    await page.getByRole('button', { name: 'Tuần sau' }).click();
    await page.waitForTimeout(300);
  }
  await slotButton.click();
  await page.getByRole('button', { name: 'Xác nhận đổi lịch', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/lich-cua-toi/${booking.id}$`));
  await expect(page.getByText(vnRange(target.startAt, target.endAt)).first()).toBeVisible();
  const after = await student.booking(booking.id);
  expect(after.slotId).toBe(target.id);
  expect(after.rescheduleCount).toBe(1);
  expect(after.status).toBe('CONFIRMED');
  expect(after.payment.status).toBe('PAID');
  const slots = await tutor.get<{ id: string; status: string }[]>(
    `/tutor/slots?from=${encodeURIComponent(new Date(Date.parse(booking.startAt) - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.parse(target.endAt) + 3_600_000).toISOString())}`,
  );
  expect(slots.find((s) => s.id === booking.slotId)?.status).toBe('AVAILABLE');
  expect(slots.find((s) => s.id === target.id)?.status).toBe('BOOKED');
  await page.goto(`/lich-cua-toi/${booking.id}/doi-lich`);
  await expect(page.getByText('Buổi học này không thể đổi lịch.')).toBeVisible();
  await expect(page.getByText('Mỗi lịch chỉ được đổi 1 lần.')).toBeVisible();
  const repeat = await student.send<{ error: { code: string } }>('post', `/bookings/${booking.id}/reschedule`, { newSlotId: booking.slotId });
  expect(repeat.status).toBe(409);
  expect(repeat.body.error.code).toBe('RESCHEDULE_LIMIT');
  expect((await student.booking(booking.id)).slotId).toBe(target.id);
  const mails = await waitForMails(booking.code, 'đổi', 2);
  expect(mails.flatMap((m) => m.To.map((to) => to.Address)).sort()).toEqual([ACCOUNTS.student.email, ACCOUNTS.tutor.email].sort());
  for (const mail of mails) {
    expect(mail.Text).toContain(booking.code);
    expect(mail.Text).toContain('(GMT+7)');
  }
});
