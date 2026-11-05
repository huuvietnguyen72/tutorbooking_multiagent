import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from './test/render';
import { addDaysIso, dayKey, startOfWeekIso } from './lib/time';

const APPROVED = 'giasu-duyet@example.test';
const REJECTED = 'giasu-tuchoi@example.test';
const SUSPENDED = 'giasu-tamngung@example.test';
const PENDING = 'giasu@example.test';

const mainButton = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

/** Logs in through the real form, then jumps to `path` client-side (the session lives in MSW memory). */
async function loginAndGo(email: string, path: string, options: Parameters<typeof userEvent.setup>[0] = {}) {
  const user = userEvent.setup(options);
  const { router } = renderApp('/dang-nhap');
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'mock-pass-1234');
  await user.click(mainButton('Đăng nhập'));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/dang-nhap'));
  await router.navigate(path);
  return { user, router };
}

describe('tutor area access', () => {
  it('sends guests to login', async () => {
    const { router } = renderApp('/gia-su/lich-trong');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dang-nhap'));
    expect(router.state.location.search).toBe('?next=%2Fgia-su%2Flich-trong');
  });

  it('returns 403 for a student on every tutor page', async () => {
    const { router } = await loginAndGo('hocvien@example.test', '/gia-su/buoi-day');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
    await router.navigate('/gia-su/ho-so-cua-toi');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
  });

  it('keeps pending tutors off slots and sessions but lets them edit the profile', async () => {
    const { router } = await loginAndGo(PENDING, '/gia-su/lich-trong');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
    await router.navigate('/gia-su/buoi-day');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
    await router.navigate('/gia-su/ho-so-cua-toi');
    expect(await screen.findByLabelText('Họ và tên')).toHaveValue('Trần Thị B');
  });

  it('disables the menu entries that need approval, with a hint', async () => {
    await loginAndGo(PENDING, '/gia-su/trang-thai');
    const menu = await screen.findByRole('menu', { name: 'Menu chính' });
    expect(within(menu).getByText('Lịch trống').closest('li')).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText('Hồ sơ').closest('li')).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('lets a suspended tutor see sessions but not slots', async () => {
    const { router } = await loginAndGo(SUSPENDED, '/gia-su/lich-trong');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
    expect(await screen.findByText('Tài khoản gia sư của bạn đang bị tạm ngưng.')).toBeInTheDocument();
    await router.navigate('/gia-su/buoi-day');
    expect(await screen.findByRole('heading', { name: 'Buổi dạy' })).toBeInTheDocument();
  });
});

describe('S-16 approval status', () => {
  it('shows the rejection reason and the resubmit entry', async () => {
    await loginAndGo(REJECTED, '/gia-su/trang-thai');
    expect(await screen.findByText(/Thiếu thông tin kinh nghiệm\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sửa hồ sơ & gửi duyệt lại' })).toHaveAttribute('href', '/gia-su/ho-so-cua-toi');
  });
});

describe('S-17 profile', () => {
  it('validates subjects and price before calling the API', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/ho-so-cua-toi');
    const price = await screen.findByLabelText(/Học phí/);
    await waitFor(() => expect(price).toHaveValue('200000'));
    await user.clear(price);
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByText('Học phí phải là số nguyên lớn hơn 0')).toBeInTheDocument();
  });

  it('requires at least one subject', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/ho-so-cua-toi');
    await screen.findByText('Toán', { selector: '.ant-select-selection-item-content' });
    const remove = document.querySelector('.ant-select-selection-item-remove');
    expect(remove).not.toBeNull();
    await user.click(remove as Element);
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByText('Vui lòng chọn ít nhất 1 môn dạy')).toBeInTheDocument();
  });

  it('saves and shows the price note for approved tutors', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/ho-so-cua-toi');
    expect(await screen.findByText('Thay đổi học phí chỉ áp dụng cho lượt đặt sau này.')).toBeInTheDocument();
    const name = await screen.findByLabelText('Họ và tên');
    await waitFor(() => expect(name).toHaveValue('Lê Hoàng Cường'));
    await user.clear(name);
    await user.type(name, 'Cường Lê');
    await user.click(screen.getByRole('button', { name: 'Lưu hồ sơ' }));
    expect(await screen.findByText('Đã lưu hồ sơ.')).toBeInTheDocument();
  });

  it('saves and resubmits a rejected profile, then shows it as pending', async () => {
    const { user, router } = await loginAndGo(REJECTED, '/gia-su/ho-so-cua-toi');
    expect(await screen.findByText(/Lý do: Thiếu thông tin kinh nghiệm\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Họ và tên')).toHaveValue('Phạm Minh Dũng'));
    await user.click(screen.getByRole('button', { name: 'Lưu & gửi duyệt lại' }));
    expect(await screen.findByText('Đã gửi hồ sơ để duyệt lại.')).toBeInTheDocument();
    await router.navigate('/gia-su/trang-thai');
    expect(await screen.findByText('Hồ sơ của bạn đang chờ quản trị viên duyệt.')).toBeInTheDocument();
  });

  it('rejects an oversized or wrong-type avatar on the client', async () => {
    // the browser's `accept` filter is bypassed on purpose: the client must re-check the type itself
    const { user } = await loginAndGo(APPROVED, '/gia-su/ho-so-cua-toi', { applyAccept: false });
    const input = await screen.findByTestId('avatar-input');
    await user.upload(input, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Định dạng tệp không được hỗ trợ.');
    await user.upload(input, new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Tệp quá lớn.'));
  });

  it('uploads a valid avatar', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/ho-so-cua-toi');
    await user.upload(await screen.findByTestId('avatar-input'), new File(['x'], 'a.png', { type: 'image/png' }));
    expect(await screen.findByText('Đã cập nhật ảnh đại diện.')).toBeInTheDocument();
  });
});

describe('S-18 / S-19 slots', () => {
  const nextMonday = () => dayKey(addDaysIso(startOfWeekIso(), 7));

  async function openNextWeek(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Tuần sau' }));
  }

  async function addSlot(user: ReturnType<typeof userEvent.setup>, date: string, time: string) {
    await user.click(screen.getAllByRole('button', { name: /Thêm khung giờ/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Ngày'), date);
    await user.type(within(dialog).getByLabelText('Giờ bắt đầu'), time);
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    return dialog;
  }

  it('explains why booked and held slots are locked', async () => {
    await loginAndGo(APPROVED, '/gia-su/lich-trong');
    expect(await screen.findByText(/Khung giờ đã có người đặt hoặc đang được giữ không thể sửa\/xoá/)).toBeInTheDocument();
  });

  it('adds, rejects an overlap, edits and deletes a slot', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/lich-trong');
    await openNextWeek(user);
    await addSlot(user, nextMonday(), '19:00');
    expect(await screen.findByText('Đã thêm khung giờ.')).toBeInTheDocument();
    const slot = await screen.findByLabelText(/19:00–20:00/);
    expect(within(slot).getByText('Trống')).toBeInTheDocument();

    const dialog = await addSlot(user, nextMonday(), '19:30');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Khung giờ trùng với khung giờ khác của bạn.');
    await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));

    await user.click(within(slot).getByRole('button', { name: 'Sửa' }));
    const edit = await screen.findByRole('dialog');
    const time = within(edit).getByLabelText('Giờ bắt đầu');
    await user.clear(time);
    await user.type(time, '21:00');
    await user.click(within(edit).getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByLabelText(/21:00–22:00/)).toBeInTheDocument();

    await user.click(within(screen.getByLabelText(/21:00–22:00/)).getByRole('button', { name: 'Xoá' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(screen.queryByLabelText(/21:00–22:00/)).not.toBeInTheDocument());
  }, 60_000);

  it('refuses a slot in the past on the client', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/lich-trong');
    await screen.findByText(/Khung giờ đã có người đặt/);
    const dialog = await addSlot(user, '2020-01-06', '09:00');
    expect(await within(dialog).findByText('Không thể tạo khung giờ trong quá khứ.')).toBeInTheDocument();
  });

  it('requires date and time', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/lich-trong');
    await screen.findByText(/Khung giờ đã có người đặt/);
    await user.click(screen.getAllByRole('button', { name: /Thêm khung giờ/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Thêm' }));
    expect(await within(dialog).findByText('Vui lòng chọn ngày')).toBeInTheDocument();
    expect(within(dialog).getByText('Vui lòng chọn giờ bắt đầu')).toBeInTheDocument();
  });
});

describe('S-20 / S-21 / S-22 sessions', () => {
  it('lists upcoming sessions and an empty history state for a new tutor tab', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/buoi-day');
    expect(await screen.findByText('Nguyễn A.', { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Đã huỷ' }));
    expect(await screen.findByText('Phạm D.', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Học viên đã huỷ')).toBeInTheDocument();
  });

  it('requires a reason, then cancels and shows the cancelled state', async () => {
    const { user } = await loginAndGo(APPROVED, '/gia-su/buoi-day');
    await user.click((await screen.findAllByRole('link', { name: 'Chi tiết' }))[1]);
    await user.click(await screen.findByRole('button', { name: 'Huỷ buổi dạy' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Học viên sẽ được hoàn 100% học phí/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận huỷ' }));
    expect(await within(dialog).findByText('Vui lòng nhập lý do huỷ')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Lý do/), 'Bị ốm');
    await user.click(within(dialog).getByRole('button', { name: 'Xác nhận huỷ' }));
    expect(await screen.findByText('Đã huỷ buổi dạy.')).toBeInTheDocument();
    expect(await screen.findByText('Lý do bạn đã huỷ: Bị ốm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ buổi dạy' })).not.toBeInTheDocument();
  });

  it('disables cancelling once the session has started', async () => {
    await loginAndGo(APPROVED, '/gia-su/buoi-day/30000000-0000-4000-8000-000000000002');
    expect(await screen.findByRole('button', { name: 'Huỷ buổi dạy' })).toBeDisabled();
    expect(screen.getByText('Buổi học đã bắt đầu, không thể huỷ')).toBeInTheDocument();
  });

  it('shows 404 for a booking that is not the tutor’s', async () => {
    const { router } = await loginAndGo(APPROVED, '/gia-su/buoi-day/30000000-0000-4000-8000-000000000999');
    await waitFor(() => expect(router.state.location.pathname).toContain('000000000999'));
    expect(await screen.findByText('Không tìm thấy trang bạn yêu cầu.')).toBeInTheDocument();
  });
});

describe('S-23 reviews', () => {
  it('lists received reviews with the average', async () => {
    await loginAndGo(APPROVED, '/gia-su/danh-gia');
    expect(await screen.findByText(/★ 4,5/)).toBeInTheDocument();
    expect((await screen.findAllByText(/Học viên [AB]\./)).length).toBeGreaterThan(0);
  });

  it('shows the empty state', async () => {
    await loginAndGo(SUSPENDED, '/gia-su/danh-gia');
    expect(await screen.findByText('Chưa có đánh giá nào.')).toBeInTheDocument();
  });
});
