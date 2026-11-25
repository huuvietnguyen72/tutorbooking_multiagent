import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { addDaysIso, startOfWeekIso } from './lib/time';
import { server } from './mocks/server';
import { renderApp } from './test/render';
import { expectForbidden } from './test/navigation';

/** Header and page both have "Đăng nhập"/"Đăng ký" buttons; page actions live in <main>. */
const mainButton = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

async function login(user: ReturnType<typeof userEvent.setup>, email: string, password = 'mock-pass-1234') {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), password);
  await user.click(mainButton('Đăng nhập'));
}

describe('route guards', () => {
  it('sends guests to login with ?next= for protected pages', async () => {
    const { router } = renderApp('/lich-cua-toi');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dang-nhap'));
    expect(router.state.location.search).toBe('?next=%2Flich-cua-toi');
  });

  it('returns 403 page for the wrong role', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-nhap');
    await login(user, 'hocvien@example.test');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su'));
    await router.navigate('/admin');
    await expectForbidden(router);
  });

  it('lets a student reach student pages and a tutor not', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-nhap');
    await login(user, 'giasu@example.test');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
    expect(await screen.findByText('Hồ sơ của bạn đang chờ quản trị viên duyệt.')).toBeInTheDocument();
    await router.navigate('/lich-cua-toi');
    await expectForbidden(router);
  });
});

describe('login', () => {
  it('shows mapped text, not the server message, for wrong credentials', async () => {
    const user = userEvent.setup();
    renderApp('/dang-nhap');
    await login(user, 'hocvien@example.test', 'sai-mat-khau');
    expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
    expect(screen.queryByText('INVALID_CREDENTIALS')).not.toBeInTheDocument();
  });

  it('shows the locked message', async () => {
    const user = userEvent.setup();
    renderApp('/dang-nhap');
    await login(user, 'khoa@example.test');
    expect(await screen.findByRole('alert')).toHaveTextContent('Tài khoản của bạn đã bị khoá. Liên hệ quản trị viên.');
  });

  it('validates fields client-side', async () => {
    const user = userEvent.setup();
    renderApp('/dang-nhap');
    await screen.findByLabelText('Email');
    await user.click(mainButton('Đăng nhập'));
    expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng nhập mật khẩu')).toBeInTheDocument();
  });

  it('ignores an external ?next= target', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-nhap?next=https%3A%2F%2Fevil.test');
    await login(user, 'hocvien@example.test');
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su'));
  });

  it('resumes the chosen slot after logging in from "Đặt lịch"', async () => {
    const tutorId = '00000000-0000-4000-8000-000000000001';
    const slotId = '30000000-0000-4000-8000-0000000000aa';
    const next = `/gia-su/${tutorId}?slot=${slotId}`;
    const user = userEvent.setup();
    const { router } = renderApp(`/dang-nhap?next=${encodeURIComponent(next)}`);
    await login(user, 'hocvien@example.test');
    await waitFor(() => expect(router.state.location.pathname).toBe(`/dat-lich/${slotId}`));
  });

  it('forces a password change before anything else', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-nhap');
    await login(user, 'admin@example.test');
    await waitFor(() => expect(router.state.location.pathname).toBe('/doi-mat-khau'));
    await router.navigate('/gia-su');
    await waitFor(() => expect(router.state.location.pathname).toBe('/doi-mat-khau'));

    await user.type(await screen.findByLabelText('Mật khẩu hiện tại'), 'khong-dung-123');
    await user.type(screen.getByLabelText('Mật khẩu mới'), 'mat-khau-moi-1');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'mat-khau-moi-1');
    await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    expect(await screen.findByText('Mật khẩu hiện tại không đúng.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Mật khẩu hiện tại'));
    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'mock-pass-1234');
    await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
  });
});

describe('register', () => {
  it('creates a student account and lands on the tutor search', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-ky');
    await user.type(await screen.findByLabelText('Họ và tên'), 'Lê Văn C');
    await user.type(screen.getByLabelText('Email'), 'moi@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-12345');
    await user.click(mainButton('Đăng ký'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su'));
  });

  it('shows the duplicate-email error on the email field', async () => {
    const user = userEvent.setup();
    renderApp('/dang-ky');
    await user.type(await screen.findByLabelText('Họ và tên'), 'Lê Văn C');
    await user.type(screen.getByLabelText('Email'), 'hocvien@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-12345');
    await user.click(mainButton('Đăng ký'));
    expect(await screen.findByText('Email đã được sử dụng.')).toBeInTheDocument();
  });

  it('puts tutors on the approval gate and shows the note', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/dang-ky');
    await user.click(await screen.findByLabelText('Gia sư'));
    expect(screen.getByText('Hồ sơ gia sư cần quản trị viên duyệt trước khi hiển thị.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Họ và tên'), 'Gia Sư Mới');
    await user.type(screen.getByLabelText('Email'), 'gs-moi@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-12345');
    await user.click(mainButton('Đăng ký'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
  });

  it('resumes the chosen slot after registering from "Đặt lịch"', async () => {
    const tutorId = '00000000-0000-4000-8000-000000000001';
    const slotId = '30000000-0000-4000-8000-0000000000bb';
    const next = `/gia-su/${tutorId}?slot=${slotId}`;
    const user = userEvent.setup();
    const { router } = renderApp(`/dang-ky?next=${encodeURIComponent(next)}`);
    await user.type(await screen.findByLabelText('Họ và tên'), 'Lê Văn C');
    await user.type(screen.getByLabelText('Email'), 'dat-lich@example.test');
    await user.type(screen.getByLabelText('Mật khẩu'), 'mat-khau-12345');
    await user.click(mainButton('Đăng ký'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/dat-lich/${slotId}`));
  });
});

describe('tutor search', () => {
  it('lists tutors with price, subjects and rating', async () => {
    renderApp('/gia-su');
    expect(await screen.findByText('Trần Thị B')).toBeInTheDocument();
    expect(screen.getByText('Có 12 gia sư')).toBeInTheDocument();
  });

  it('shows the empty state and clears filters', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/gia-su?q=khong-ton-tai');
    expect(await screen.findByText('Không tìm thấy gia sư phù hợp.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('Trần Thị B')).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    server.use(http.get('/api/v1/tutors', () => HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'x' } }, { status: 429 })));
    renderApp('/gia-su');
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn thao tác quá nhanh');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('applies the sort option to the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/gia-su');
    await screen.findByText('Trần Thị B');
    await user.click(screen.getByRole('combobox', { name: /Sắp xếp/ }));
    await user.click(await screen.findByText('Học phí tăng dần'));
    await waitFor(() => expect(router.state.location.search).toBe('?sort=price_asc'));
  });
});

describe('tutor profile', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('shows profile, price, slots and reviews', async () => {
    renderApp(`/gia-su/${id}`);
    expect(await screen.findByRole('heading', { name: 'Trần Thị B' })).toBeInTheDocument();
    expect((await screen.findAllByText('Dạy dễ hiểu, nhiệt tình.')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Giờ Việt Nam \(GMT\+7\)/)).toBeInTheDocument();
  });

  it('shows 404 for an unknown tutor', async () => {
    renderApp('/gia-su/00000000-0000-4000-8000-0000000000ff');
    expect(await screen.findByText('Không tìm thấy trang bạn yêu cầu.')).toBeInTheDocument();
  });

  it('sends a guest to login with the slot to come back to', async () => {
    // Wednesday 10:00 of the *current* display week: the page opens on this week, so a "now + N days" slot can fall into next week.
    const slotStart = new Date(new Date(addDaysIso(startOfWeekIso(), 2)).getTime() + 10 * 3_600_000).toISOString();
    server.use(
      http.get(`/api/v1/tutors/${id}/slots`, () =>
        HttpResponse.json([
          { id: '30000000-0000-4000-8000-000000000001', startAt: slotStart, endAt: new Date(new Date(slotStart).getTime() + 3_600_000).toISOString(), status: 'AVAILABLE' },
        ]),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderApp(`/gia-su/${id}`);
    const group = await screen.findByRole('region', { name: 'Lịch trống' });
    const slotButton = await within(group).findByRole('button', { name: /\d\d:\d\d–\d\d:\d\d/ });
    await user.click(slotButton);
    await waitFor(() => expect(router.state.location.pathname).toBe('/dang-nhap'));
    expect(decodeURIComponent(router.state.location.search)).toBe(
      `?next=/gia-su/${id}?slot=30000000-0000-4000-8000-000000000001`,
    );
  });
});
