import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { slotsFor } from './mocks/handlers';
import { mockControl, seedStudentBooking } from './mocks/studentHandlers';
import { tutors } from './mocks/data';
import { useCountdown } from './lib/useCountdown';
import { renderApp } from './test/render';

// Short polling so the S-09 tests run in well under a second.
vi.mock('./lib/polling', () => ({ RESULT_POLL_MS: 40, RESULT_POLL_MAX_MS: 1500 }));

const STUDENT = 'hocvien@example.test';
const HOUR = 3_600_000;
const mainButton = (name: string | RegExp) => within(screen.getByRole('main')).getByRole('button', { name });

async function loginAndGo(email: string, path: string) {
  const user = userEvent.setup();
  const { router } = renderApp('/dang-nhap');
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'mock-pass-1234');
  await user.click(mainButton('Đăng nhập'));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/dang-nhap'));
  await router.navigate(path);
  return { user, router };
}

/** First bookable slot of a tutor within the next two weeks. */
function availableSlot(tutorIndex = 0, skip = 0) {
  const slots = slotsFor(tutors[tutorIndex].id, new Date().toISOString(), new Date(Date.now() + 14 * 24 * HOUR).toISOString());
  const slot = slots.filter((s) => s.status === 'AVAILABLE')[skip];
  if (!slot) throw new Error('no mock slot');
  return slot;
}

describe('student routes access', () => {
  it('sends guests to login and keeps the target in ?next=', async () => {
    const { router } = renderApp('/lich-cua-toi');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dang-nhap'));
    expect(router.state.location.search).toBe('?next=%2Flich-cua-toi');
  });

  it('returns 403 for a tutor on every student page, including the gateway', async () => {
    const { router } = await loginAndGo('giasu-duyet@example.test', '/lich-cua-toi');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
    await router.navigate('/cong-thanh-toan-gia-lap/70000000-0000-4000-8000-000000000001');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
    await router.navigate('/dat-lich/20000000-0000-4000-8000-000000000001');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
  });

  it("shows 404, not someone else's data, for a booking the student does not own", async () => {
    const other = seedStudentBooking('u-someone-else', { startAt: Date.now() + 72 * HOUR });
    const { router } = await loginAndGo(STUDENT, `/lich-cua-toi/${other.id}`);
    expect(await screen.findByText('404')).toBeInTheDocument();
    await router.navigate(`/thanh-toan/${other.id}/ket-qua`);
    expect(await screen.findByText('404')).toBeInTheDocument();
    await router.navigate(`/cong-thanh-toan-gia-lap/${other.payment.id}`);
    expect(await screen.findByText('404')).toBeInTheDocument();
  });
});

describe('booking and payment (S-06 to S-09)', () => {
  it('books a slot, pays at the mock gateway and shows the confirmed result', async () => {
    const slot = availableSlot();
    const { user, router } = await loginAndGo(STUDENT, `/dat-lich/${slot.id}`);

    expect(await screen.findByText('Xác nhận đặt lịch')).toBeInTheDocument();
    expect(screen.getByText(/giữ cho bạn trong 15 phút/)).toBeInTheDocument();
    expect(screen.getByText(/còn từ 24 giờ trở lên/)).toBeInTheDocument();
    await user.click(mainButton('Xác nhận & thanh toán'));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/thanh-toan\/[^/]+$/));
    expect(await screen.findByText(/Mã đặt lịch #BK-/)).toBeInTheDocument();
    expect(screen.getByTestId('hold-countdown').textContent).toMatch(/^1[45]:\d\d$/);
    await user.click(mainButton('Thanh toán ngay'));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/cong-thanh-toan-gia-lap\//));
    expect(await screen.findByText('Cổng thanh toán giả lập')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Thanh toán thành công/ }));

    expect(await screen.findByText('Đặt lịch thành công!')).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/\/ket-qua$/);
    expect(screen.getByText(/Email xác nhận sẽ được gửi tới hocvien@example.test/)).toBeInTheDocument();
  });

  it('shows the failure variant when the gateway declines, from the real booking state', async () => {
    const slot = availableSlot(0, 1);
    const { user } = await loginAndGo(STUDENT, `/dat-lich/${slot.id}`);
    await user.click(await screen.findByRole('button', { name: 'Xác nhận & thanh toán' }));
    await user.click(await screen.findByRole('button', { name: 'Thanh toán ngay' }));
    await user.click(await screen.findByRole('button', { name: /Thanh toán thất bại/ }));
    expect(await screen.findByText('Thanh toán không thành công')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đặt lại khung giờ này' })).toBeInTheDocument();
  });

  it('does not trust the URL: the result page of an unpaid booking never claims success', async () => {
    const pending = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    await loginAndGo(STUDENT, `/thanh-toan/${pending.id}/ket-qua?status=success&resultCode=00`);
    expect(await screen.findByText('Đang xác nhận thanh toán…')).toBeInTheDocument();
    expect(screen.queryByText('Đặt lịch thành công!')).not.toBeInTheDocument();
  });

  it('polls until the webhook lands, then shows success', async () => {
    mockControl.webhookDelayMs = 300;
    const pending = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    const { user } = await loginAndGo(STUDENT, `/cong-thanh-toan-gia-lap/${pending.payment.id}`);
    await user.click(await screen.findByRole('button', { name: /Thanh toán thành công/ }));
    expect(await screen.findByText('Đang xác nhận thanh toán…')).toBeInTheDocument();
    expect(await screen.findByText('Đặt lịch thành công!', {}, { timeout: 1200 })).toBeInTheDocument();
  });

  it('stops polling after the limit and does not guess an outcome', async () => {
    mockControl.webhookDelayMs = 60_000;
    const pending = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    const { user } = await loginAndGo(STUDENT, `/cong-thanh-toan-gia-lap/${pending.payment.id}`);
    await user.click(await screen.findByRole('button', { name: /Thanh toán thành công/ }));
    expect(await screen.findByText(/chưa nhận được kết quả/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('Đặt lịch thành công!')).not.toBeInTheDocument();
  });

  it('late payment on an expired hold: gateway still offers success, result says it was refunded', async () => {
    const expired = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    expired.holdExpiresAt = new Date(Date.now() - 60_000).toISOString();
    const { user } = await loginAndGo(STUDENT, `/cong-thanh-toan-gia-lap/${expired.payment.id}`);
    expect(await screen.findByText(/Đặt chỗ đã hết hạn giữ/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Thanh toán thành công/ }));
    expect(await screen.findByText('Đã hết thời gian giữ chỗ')).toBeInTheDocument();
    expect(screen.getByText('Khoản thanh toán đã được tự động hoàn lại.')).toBeInTheDocument();
  });

  it('a gateway payment can be completed only once', async () => {
    const pending = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    const { user, router } = await loginAndGo(STUDENT, `/cong-thanh-toan-gia-lap/${pending.payment.id}`);
    await user.click(await screen.findByRole('button', { name: /Thanh toán thành công/ }));
    await screen.findByText('Đặt lịch thành công!');
    await router.navigate(`/cong-thanh-toan-gia-lap/${pending.payment.id}`);
    expect(await screen.findByText('Giao dịch này đã được xử lý.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thanh toán thành công/ })).not.toBeInTheDocument();
  });

  it('redirects the payment page of a paid booking to its result', async () => {
    const paid = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR });
    const { router } = await loginAndGo(STUDENT, `/thanh-toan/${paid.id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/thanh-toan/${paid.id}/ket-qua`));
    expect(await screen.findByText('Đặt lịch thành công!')).toBeInTheDocument();
  });

  it('shows the student-overlap error with the conflicting time on S-06', async () => {
    const slot = availableSlot(0);
    seedStudentBooking('u-student', { startAt: Date.parse(slot.startAt), tutorIndex: 1 });
    const { user } = await loginAndGo(STUDENT, `/dat-lich/${slot.id}`);
    await user.click(await screen.findByRole('button', { name: 'Xác nhận & thanh toán' }));
    expect(await screen.findByText(/Bạn đã có buổi học trùng giờ này \(/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn khung giờ khác' })).toBeInTheDocument();
  });

  it('releases an unpaid hold from S-07', async () => {
    const slot = availableSlot(0, 2);
    const { user, router } = await loginAndGo(STUDENT, `/dat-lich/${slot.id}`);
    await user.click(await screen.findByRole('button', { name: 'Xác nhận & thanh toán' }));
    await user.click(await screen.findByRole('button', { name: 'Huỷ đặt chỗ' }));
    expect(await screen.findByText('Bạn muốn bỏ đặt chỗ này?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ đặt chỗ' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lich-cua-toi'));
  });
});

describe('useCountdown', () => {
  it('uses the server clock, so a wrong local clock does not move the deadline', () => {
    const serverNow = Date.now() + 3 * HOUR; // local clock is 3 h behind
    const { result } = renderHook(() =>
      useCountdown(new Date(serverNow + 5 * 60_000).toISOString(), new Date(serverNow).toISOString()),
    );
    expect(result.current).toBeGreaterThan(4.9 * 60_000);
    expect(result.current).toBeLessThanOrEqual(5 * 60_000);
  });

  it('is null without a deadline and clamps at zero', () => {
    expect(renderHook(() => useCountdown(null, undefined)).result.current).toBeNull();
    const past = new Date(Date.now() - HOUR).toISOString();
    expect(renderHook(() => useCountdown(past, new Date().toISOString())).result.current).toBe(0);
  });
});

describe('my bookings and detail (S-10, S-11)', () => {
  it('lists upcoming, past and cancelled bookings per tab', async () => {
    seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR });
    seedStudentBooking('u-student', { startAt: Date.now() - 72 * HOUR });
    seedStudentBooking('u-student', { status: 'CANCELLED_BY_TUTOR', startAt: Date.now() + 96 * HOUR });
    const { user } = await loginAndGo(STUDENT, '/lich-cua-toi');
    expect(await screen.findByText('Đã xác nhận')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Đã qua' }));
    expect(await screen.findByRole('button', { name: 'Đánh giá' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Đã huỷ / Hết hạn' }));
    expect(await screen.findByText('Đã huỷ bởi gia sư')).toBeInTheDocument();
  });

  it('shows the empty state with a call to action', async () => {
    await loginAndGo(STUDENT, '/lich-cua-toi');
    expect(await screen.findByText('Bạn chưa có buổi học nào.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tìm gia sư' })).toBeInTheDocument();
  });

  it('disables cancel and reschedule inside the window, using the server reasonCode', async () => {
    const soon = seedStudentBooking('u-student', { startAt: Date.now() + 5 * HOUR });
    await loginAndGo(STUDENT, `/lich-cua-toi/${soon.id}`);
    expect(await screen.findByRole('button', { name: 'Huỷ buổi học' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đổi lịch' })).toBeDisabled();
    expect(screen.getByText(/Không thể huỷ hoặc đổi lịch khi còn dưới 24 giờ/)).toBeInTheDocument();
  });

  it('disables reschedule after one change but still allows cancelling', async () => {
    const once = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR, rescheduleCount: 1 });
    await loginAndGo(STUDENT, `/lich-cua-toi/${once.id}`);
    expect(await screen.findByRole('button', { name: 'Đổi lịch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ buổi học' })).toBeEnabled();
    expect(screen.getByText(/Mỗi lịch chỉ được đổi 1 lần\./)).toBeInTheDocument();
  });

  it('cancels a booking with a 100% refund note', async () => {
    const far = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR });
    const { user } = await loginAndGo(STUDENT, `/lich-cua-toi/${far.id}`);
    await user.click(await screen.findByRole('button', { name: 'Huỷ buổi học' }));
    expect(await screen.findByText(/hoàn 100% học phí/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
    expect(await screen.findByText('Đã huỷ bởi bạn.')).toBeInTheDocument();
    expect(screen.getByText(/Đã hoàn .* \(giả lập\)\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ buổi học' })).not.toBeInTheDocument();
  });

  it('closes the cancel modal and shows the real state when the deadline passes meanwhile', async () => {
    const edge = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR });
    const { user } = await loginAndGo(STUDENT, `/lich-cua-toi/${edge.id}`);
    await user.click(await screen.findByRole('button', { name: 'Huỷ buổi học' }));
    edge.startAt = new Date(Date.now() + 23 * HOUR).toISOString(); // the 24 h mark passes while the modal is open
    await user.click(screen.getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(screen.queryByText('Huỷ buổi học?')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Huỷ buổi học' })).toBeDisabled();
  });

  it('reviews a finished session: stars are required, then the review is shown and cannot be repeated', async () => {
    const done = seedStudentBooking('u-student', { startAt: Date.now() - 72 * HOUR });
    const { user } = await loginAndGo(STUDENT, `/lich-cua-toi/${done.id}`);
    await user.click(await screen.findByRole('button', { name: 'Đánh giá gia sư' }));
    await user.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    expect(await screen.findByText('Vui lòng chọn số sao')).toBeInTheDocument();
    await user.click(screen.getAllByRole('radio')[3]);
    await user.type(screen.getByLabelText('Nhận xét (không bắt buộc)'), 'Dạy rất dễ hiểu');
    await user.click(screen.getByRole('button', { name: 'Gửi đánh giá' }));
    expect(await screen.findByText('Đánh giá của bạn')).toBeInTheDocument();
    expect(screen.getByText('Dạy rất dễ hiểu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đánh giá gia sư' })).not.toBeInTheDocument();
  }, 60000);

  it('explains why review is not yet possible before the session ends', async () => {
    const upcoming = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR });
    await loginAndGo(STUDENT, `/lich-cua-toi/${upcoming.id}`);
    expect(await screen.findByRole('button', { name: 'Đánh giá gia sư' })).toBeDisabled();
    expect(screen.getByText(/Bạn có thể đánh giá sau khi buổi học kết thúc/)).toBeInTheDocument();
  });

  it('offers to rebook an expired hold', async () => {
    const pending = seedStudentBooking('u-student', { status: 'PENDING_PAYMENT', startAt: Date.now() + 72 * HOUR });
    pending.holdExpiresAt = new Date(Date.now() - 1000).toISOString();
    await loginAndGo(STUDENT, `/lich-cua-toi/${pending.id}`);
    expect(await screen.findByText('Đặt chỗ đã hết hạn, khung giờ đã được mở lại.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đặt lại' })).toBeInTheDocument();
  });
});

describe('reschedule (S-13)', () => {
  it('moves a booking to another slot of the same tutor, once', async () => {
    const booking = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR, tutorIndex: 0 });
    const { user, router } = await loginAndGo(STUDENT, `/lich-cua-toi/${booking.id}`);
    await user.click(await screen.findByRole('button', { name: 'Đổi lịch' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/lich-cua-toi/${booking.id}/doi-lich`));

    // Find a week with an enabled slot.
    const slotButtons = () =>
      within(screen.getByRole('main')).queryAllByRole('button').filter((b) => /^\d\d:\d\d–\d\d:\d\d$/.test(b.textContent ?? '') && !(b as HTMLButtonElement).disabled);
    for (let i = 0; i < 4 && slotButtons().length === 0; i += 1) {
      await user.click(await screen.findByRole('button', { name: 'Tuần sau', exact: true }));
      await waitFor(() => expect(document.querySelector('section .ant-skeleton')).not.toBeInTheDocument());
    }
    await waitFor(() => expect(slotButtons().length).toBeGreaterThan(0));
    await user.click(slotButtons()[0]);
    expect(await screen.findByText(/Đã chọn:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xác nhận đổi lịch' }));
    expect(await screen.findByText('Sau khi đổi bạn sẽ không thể đổi lại lần nữa. Tiếp tục?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/lich-cua-toi/${booking.id}`));
    expect(await screen.findByText('1/1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đổi lịch' })).toBeDisabled();
  }, 60000);

  it('refuses the reschedule page when the server says it is not allowed', async () => {
    const once = seedStudentBooking('u-student', { startAt: Date.now() + 72 * HOUR, rescheduleCount: 1 });
    await loginAndGo(STUDENT, `/lich-cua-toi/${once.id}/doi-lich`);
    expect(await screen.findByText('Buổi học này không thể đổi lịch.')).toBeInTheDocument();
  });
});
