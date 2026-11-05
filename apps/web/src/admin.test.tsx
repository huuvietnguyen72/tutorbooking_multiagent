import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { api } from './api/endpoints';
import { users } from './mocks/data';
import { renderApp } from './test/render';
import { todayKey, toUtcIso, addDaysIso } from './lib/time';

const mainButton = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

/** Logs in through the real form (admin's forced password change is switched off), then goes to `path`. */
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

const ADMIN = 'admin@example.test';

beforeEach(() => {
  const admin = users.find((u) => u.id === 'u-admin');
  if (admin) admin.mustChangePassword = false;
});

describe('admin area access', () => {
  it('sends guests to login', async () => {
    const { router } = renderApp('/admin/nguoi-dung');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dang-nhap'));
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fnguoi-dung');
  });

  it.each(['hocvien@example.test', 'giasu-duyet@example.test'])('returns 403 for %s on every admin page', async (email) => {
    const { router } = await loginAndGo(email, '/admin');
    await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
    for (const path of ['/admin/gia-su-cho-duyet', '/admin/nguoi-dung', '/admin/booking', '/admin/booking/x', '/admin/nhat-ky']) {
      await router.navigate(path);
      await waitFor(() => expect(router.state.location.pathname).toBe('/403'));
    }
  });
});

describe('admin dashboard (S-24)', () => {
  it.each(['bookingsToday', 'confirmedUpcoming'])('links %s to the matching time filter', async (counter) => {
    const requests: URL[] = [];
    server.use(http.get('/api/v1/admin/bookings', ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
    }));
    const { user, router } = await loginAndGo(ADMIN, '/admin');
    const links = await screen.findAllByRole('link', { name: 'Xem' });
    const before = Date.now();
    await user.click(links[counter === 'bookingsToday' ? 1 : 2]);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const query = requests.at(-1)!.searchParams;
    expect(query.get('status')).toBe('CONFIRMED');
    expect(router.state.location.pathname).toBe('/admin/booking');
    if (counter === 'bookingsToday') {
      const start = toUtcIso(todayKey(), '00:00');
      expect(query.get('from')).toBe(start);
      expect(query.get('to')).toBe(addDaysIso(start, 1));
    } else {
      expect(Date.parse(query.get('from')!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(query.get('from')!)).toBeLessThanOrEqual(Date.now() + 1);
      expect(query.has('to')).toBe(false);
    }
  });

  it('shows the counters', async () => {
    await loginAndGo(ADMIN, '/admin');
    expect(await screen.findByText('Gia sư chờ duyệt')).toBeInTheDocument();
    expect(screen.getByText('Hoàn tiền lỗi cần xử lý')).toBeInTheDocument();
  });
});

describe('tutor approval (S-25)', () => {
  it('lists pending tutors and approves one', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/gia-su-cho-duyet');
    const row = (await screen.findByText('giasu@example.test')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Xem' }));
    const drawer = await screen.findByRole('dialog');
    await user.click(within(drawer).getByRole('button', { name: 'Duyệt' }));
    await waitFor(() => expect(within(drawer).getByText('Đã duyệt')).toBeInTheDocument());
    expect(within(drawer).getByRole('button', { name: 'Tạm ngưng' })).toBeInTheDocument();
  });

  it('requires a reason to reject', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/gia-su-cho-duyet');
    const row = (await screen.findByText('giasu@example.test')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Xem' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Từ chối' }));
    const modal = (await screen.findByText('Từ chối gia sư Trần Thị B?')).closest('.ant-modal') as HTMLElement;
    await user.click(within(modal).getByRole('button', { name: 'Từ chối' }));
    expect(await within(modal).findByText('Vui lòng nhập lý do')).toBeInTheDocument();
    await user.type(within(modal).getByLabelText(/Lý do/), 'Thiếu bằng cấp');
    await user.click(within(modal).getByRole('button', { name: 'Từ chối' }));
    await waitFor(() => expect(screen.queryByText('Từ chối gia sư Trần Thị B?')).not.toBeInTheDocument());
  });

  it('shows the empty state when nobody is pending', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/gia-su-cho-duyet');
    await user.type(await screen.findByLabelText('Tìm theo tên hoặc email'), 'khong-co-ai{enter}');
    expect(await screen.findByText('Không có gia sư nào đang chờ duyệt.')).toBeInTheDocument();
  });
});

describe('user management (S-26)', () => {
  it('locks and unlocks a user, but never an admin', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/nguoi-dung');
    const adminRow = (await screen.findByText(ADMIN)).closest('tr') as HTMLElement;
    expect(within(adminRow).getByRole('button', { name: 'Khoá' })).toBeDisabled();

    const row = (await screen.findByText('hocvien@example.test')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Khoá' }));
    const modal = (await screen.findByText('Khoá tài khoản hocvien@example.test?')).closest('.ant-modal') as HTMLElement;
    await user.click(within(modal).getByRole('button', { name: 'Khoá' }));
    await waitFor(() => expect(within(row).getByText('Bị khoá')).toBeInTheDocument());

    await user.click(within(row).getByRole('button', { name: 'Mở khoá' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mở khoá' }));
    await waitFor(() => expect(within(row).getByText('Hoạt động')).toBeInTheDocument());
  });
});

describe('bookings (S-27/S-28)', () => {
  it.each([
    'from=invalid&to=2026-11-05',
    'from=2026-02-30&to=2026-11-05',
    'from=2026-11-06&to=2026-11-05',
    'from=2026-11-05&to=bad',
    'from=2026-1-01',
  ])('ignores invalid URL dates and remains usable: %s', async (filters) => {
    const requests: URL[] = [];
    server.use(http.get('/api/v1/admin/bookings', ({ request }) => {
      requests.push(new URL(request.url));
      return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
    }));
    const { user } = await loginAndGo(ADMIN, `/admin/booking?${filters}`);
    expect(await screen.findByText('Không có booking phù hợp bộ lọc.')).toBeInTheDocument();
    expect(requests.at(-1)!.searchParams.has('from')).toBe(false);
    expect(requests.at(-1)!.searchParams.has('to')).toBe(false);
    await user.click(screen.getByLabelText('Hoàn tiền lỗi'));
    await waitFor(() => expect(requests.at(-1)!.searchParams.get('refundFailed')).toBe('true'));
  });

  it('does not offer cancellation for a session already in progress', async () => {
    const { router } = await loginAndGo(ADMIN, '/admin');
    const detail = await api.adminGetBooking('30000000-0000-4000-8000-000000000001');
    server.use(http.get('/api/v1/admin/bookings/:bookingId', () => HttpResponse.json({
      ...detail,
      startAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      endAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      isFinished: false,
    })));
    await router.navigate(`/admin/booking/${detail.id}`);
    await screen.findByRole('heading', { name: /BK-1001/ });
    expect(screen.queryByRole('button', { name: 'Huỷ & hoàn tiền…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hoàn tiền thủ công' })).not.toBeInTheDocument();
  });

  it('preserves tutor/student URL filters and shows the empty result', async () => {
    await loginAndGo(ADMIN, '/admin/booking?tutorId=unknown&studentId=u-student');
    expect(await screen.findByText('Không có booking phù hợp bộ lọc.')).toBeInTheDocument();
    expect(screen.queryByText('#BK-1001')).not.toBeInTheDocument();
  });

  it('filters by failed refund, then cancels a booking with refund', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/booking');
    expect(await screen.findByText('#BK-1001')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Hoàn tiền lỗi'));
    await waitFor(() => expect(screen.queryByText('#BK-1001')).not.toBeInTheDocument());
    expect(screen.getByText('#BK-1003')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Hoàn tiền lỗi'));

    const row = (await screen.findByText('#BK-1001')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Chi tiết' }));
    await user.click(await screen.findByRole('button', { name: 'Huỷ & hoàn tiền…' }));
    const modal = (await screen.findByText('Huỷ booking #BK-1001?')).closest('.ant-modal') as HTMLElement;
    await user.click(within(modal).getByRole('button', { name: 'Xác nhận huỷ' }));
    expect(await within(modal).findByText('Vui lòng nhập lý do')).toBeInTheDocument();
    await user.type(within(modal).getByLabelText(/Lý do/), 'Gia sư ốm');
    await user.click(within(modal).getByRole('button', { name: 'Xác nhận huỷ' }));
    await waitFor(() => expect(screen.getByText('Đã huỷ bởi quản trị viên')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Huỷ & hoàn tiền…' })).not.toBeInTheDocument();
    expect(await screen.findByText('Quản trị viên huỷ booking')).toBeInTheDocument();
  });

  it('refunds manually once, and offers it for a finished session without cancel', async () => {
    const { user } = await loginAndGo(ADMIN, '/admin/booking');
    const row = (await screen.findByText('#BK-1002')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Chi tiết' }));
    expect(await screen.findByRole('button', { name: 'Hoàn tiền thủ công' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Huỷ & hoàn tiền…' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hoàn tiền thủ công' }));
    const modal = (await screen.findByText(/Hoàn .* cho học viên\?/)).closest('.ant-modal') as HTMLElement;
    await user.type(within(modal).getByLabelText(/Lý do/), 'Khiếu nại chất lượng');
    await user.click(within(modal).getByRole('button', { name: 'Hoàn tiền' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Hoàn tiền thủ công' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Đã hoàn tiền lúc/ })).toBeDisabled();
  });

  it('shows 404 for an unknown booking', async () => {
    await loginAndGo(ADMIN, '/admin/booking/00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText('404')).toBeInTheDocument();
  });
});
