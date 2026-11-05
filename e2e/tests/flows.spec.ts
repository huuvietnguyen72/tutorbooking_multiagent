import { ACCOUNTS } from '../fixtures/env';
import { waitForMails } from '../fixtures/mailpit';
import { expect, test } from '../fixtures/test';
import { vnRange } from '../fixtures/ui';

test('E2E-09 đổi lịch một lần: giờ mới, slot cũ mở lại và email hai bên', async ({ pageAs, student, tutor, confirmedBooking, newSlot }, testInfo) => {
  const booking = await confirmedBooking();
  const target = await newSlot(tutor, { inHours: 100 + testInfo.retry * 24 });
  const page = await pageAs('student');
  await page.goto(`/lich-cua-toi/${booking.id}`);
  await page.getByRole('link', { name: 'Đổi lịch', exact: true }).click();
  const slotButton = page.getByRole('button', { name: new RegExp(vnRange(target.startAt, target.endAt)) });
  await expect(page.getByRole('button', { name: 'Tuần sau', exact: true })).toBeVisible();
  // Wait for each week's data before deciding whether to advance again.
  for (let week = 0; week < 3; week++) {
    await expect(page.locator('section .ant-skeleton')).toHaveCount(0);
    if (await slotButton.isVisible()) break;
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/slots?') && response.request().method() === 'GET' && response.ok()),
      page.getByRole('button', { name: 'Tuần sau', exact: true }).click(),
    ]);
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
  // Query each slot separately: the randomized original can be months after the new slot.
  const slotStatus = async (slot: { id: string; startAt: string; endAt: string }) => {
    const slots = await tutor.get<{ id: string; status: string }[]>(
      `/tutor/slots?from=${encodeURIComponent(slot.startAt)}&to=${encodeURIComponent(slot.endAt)}`,
    );
    return slots.find((s) => s.id === slot.id)?.status;
  };
  expect(await slotStatus({ id: booking.slotId, startAt: booking.startAt, endAt: booking.endAt })).toBe('AVAILABLE');
  expect(await slotStatus(target)).toBe('BOOKED');
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

test('E2E-12 đánh giá sau buổi học: công khai điểm và chặn gửi lần hai', async ({ pageAs, student, confirmedBooking, db }) => {
  const booking = await confirmedBooking();
  const profilePath = `/tutors/${booking.tutor.id}`;
  const before = await student.get<{ ratingAvg: number; ratingCount: number }>(profilePath);
  await db.finishLesson(booking.id);
  expect(Date.parse((await student.booking(booking.id)).endAt)).toBeLessThan(Date.now());
  const comment = `Buổi học hữu ích ${booking.code}`;
  const page = await pageAs('student');
  await page.goto(`/lich-cua-toi/${booking.id}`);
  await page.getByRole('button', { name: 'Đánh giá gia sư', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
  await expect(dialog.getByText('Vui lòng chọn số sao')).toBeVisible();
  await dialog.getByRole('radio').nth(4).click();
  await dialog.getByLabel('Nhận xét (không bắt buộc)').fill(comment);
  await dialog.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(comment, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Đánh giá gia sư', exact: true })).toHaveCount(0);
  const saved = await student.booking(booking.id);
  expect(saved.review).toMatchObject({ rating: 5, comment });
  const duplicate = await student.send<{ error: { code: string } }>('post', `/bookings/${booking.id}/review`, { rating: 1, comment: 'duplicate' });
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe('ALREADY_REVIEWED');
  expect((await student.booking(booking.id)).review).toEqual(saved.review);
  const after = await student.get<{ ratingAvg: number; ratingCount: number }>(profilePath);
  expect(after.ratingCount).toBe(before.ratingCount + 1);
  expect(Number(after.ratingAvg)).toBeCloseTo((Number(before.ratingAvg) * before.ratingCount + 5) / after.ratingCount, 1);
  await page.goto(`/gia-su/${booking.tutor.id}`);
  await expect(page.getByText(comment, { exact: true })).toBeVisible();
});
