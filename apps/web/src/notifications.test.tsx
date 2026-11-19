import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { seedNotification } from './mocks/notificationHandlers';
import { renderApp } from './test/render';

const mainButton = (name: string | RegExp) => within(screen.getByRole('main')).getByRole('button', { name });

async function loginAs(email: string, userId: string) {
  const user = userEvent.setup();
  const { router } = renderApp('/dang-nhap');
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'mock-pass-1234');
  await user.click(mainButton('Đăng nhập'));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/dang-nhap'));
  return { user, router, userId };
}

const bell = (name: RegExp) => screen.findByRole('button', { name });

describe('notification center', () => {
  it('shows the unread count on the bell', async () => {
    seedNotification('u-student', { title: 'Lịch học đã xác nhận' });
    seedNotification('u-student', { title: 'Đã đọc rồi', isRead: true });
    await loginAs('hocvien@example.test', 'u-student');
    expect(await bell(/1 chưa đọc/)).toBeInTheDocument();
  });

  it('does not show a bell to guests', async () => {
    renderApp('/gia-su');
    await screen.findByRole('button', { name: 'Đăng nhập' });
    expect(screen.queryByRole('button', { name: /^Thông báo/ })).not.toBeInTheDocument();
  });

  it('opens the panel and marks one notification read', async () => {
    seedNotification('u-student', { title: 'Lịch học đã xác nhận', bookingId: 'b-1' });
    seedNotification('u-student', { title: 'Lịch học bị huỷ' });
    const { user } = await loginAs('hocvien@example.test', 'u-student');
    await user.click(await bell(/2 chưa đọc/));
    expect(await screen.findByText('Lịch học đã xác nhận')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đánh dấu đã đọc: Lịch học đã xác nhận' }));
    await bell(/1 chưa đọc/);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đánh dấu đã đọc: Lịch học đã xác nhận' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Đánh dấu đã đọc: Lịch học bị huỷ' })).toBeInTheDocument();
  });

  it('marks everything read and links to the related booking', async () => {
    seedNotification('u-student', { title: 'Lịch học đã xác nhận', bookingId: 'b-1' });
    seedNotification('u-student', { title: 'Lịch học bị huỷ' });
    const { user, router } = await loginAs('hocvien@example.test', 'u-student');
    await user.click(await bell(/2 chưa đọc/));
    await user.click(await screen.findByRole('button', { name: 'Đọc tất cả' }));
    await bell(/^Thông báo$/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Đánh dấu đã đọc/ })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Xem chi tiết' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lich-cua-toi/b-1'));
  });

  it('shows an empty state without notifications', async () => {
    const { user } = await loginAs('giasu-duyet@example.test', 'u-tutor-ok');
    await user.click(await bell(/^Thông báo$/));
    expect(await screen.findByText('Chưa có thông báo nào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đọc tất cả' })).toBeDisabled();
  });
});
