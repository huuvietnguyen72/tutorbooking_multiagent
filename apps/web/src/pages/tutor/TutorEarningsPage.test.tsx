import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../../mocks/server';
import { currentMonth, shiftMonth } from '../../lib/time';
import { renderApp } from '../../test/render';

const APPROVED = 'giasu-duyet@example.test';
const PENDING = 'giasu@example.test';
const EARNINGS = '/gia-su/thu-nhap';

/** `683.333 ₫` however the locale spaces it. */
const vnd = (text: string) => (content: string) => content.replace(/\s/g, ' ') === text;

async function loginAndGo(email: string, path: string) {
  const user = userEvent.setup();
  const { router } = renderApp('/dang-nhap');
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Mật khẩu'), 'mock-pass-1234');
  await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Đăng nhập' }));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/dang-nhap'));
  await router.navigate(path);
  return { user, router };
}

/** Records the query string of every earnings call. */
function recordCalls() {
  const calls: { path: string; params: URLSearchParams }[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.includes('/tutor/earnings')) calls.push({ path: url.pathname, params: url.searchParams });
  });
  return calls;
}

async function pickMonth(user: ReturnType<typeof userEvent.setup>, month: string) {
  await user.click(screen.getByRole('combobox', { name: 'Chọn tháng' }));
  const [y, m] = month.split('-');
  await user.click(await screen.findByTitle(`Tháng ${m}/${y}`));
}

describe('S-29 / S-30 tutor earnings', () => {
  it('shows the menu entry and the figures of the current month with the API fee rate', async () => {
    await loginAndGo(APPROVED, EARNINGS);
    expect(await screen.findByRole('heading', { name: 'Thu nhập' })).toBeInTheDocument();
    expect(within(screen.getByRole('menu', { name: 'Menu chính' })).getByText('Thu nhập')).toBeInTheDocument();
    // 3 sessions: 200.000 + 150.000 + 333.333; fees 20.000 + 15.000 + 33.333
    expect(await screen.findByText(vnd('683.333 ₫'))).toBeInTheDocument();
    expect(screen.getByText('Số buổi đã dạy', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('3');
    expect(screen.getByText('Phí nền tảng', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('68.333');
    expect(screen.getByText('Thực nhận', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('615.000');
    expect(screen.getByText('Đã đối soát', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('180.000');
    expect(screen.getByText('Chưa đối soát', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('435.000');
    expect(screen.getByText('Phí nền tảng là 10% giá buổi học.')).toBeInTheDocument();
    expect(screen.getByText(/Điều chỉnh hoàn tiền trong tháng: -180\.000/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Các buổi dạy tính vào thu nhập' });
    expect(await within(table).findAllByText(/^BK-000[123]$/)).toHaveLength(3);
  });

  it('keeps a tutor who is not approved off the page', async () => {
    const { router } = await loginAndGo(PENDING, EARNINGS);
    await waitFor(() => expect(router.state.location.pathname).toBe('/gia-su/trang-thai'));
  });

  it('switches month with the right parameter and shows the empty state for a month without sessions', async () => {
    const calls = recordCalls();
    const { user } = await loginAndGo(APPROVED, EARNINGS);
    await screen.findByText(vnd('683.333 ₫'));
    expect(calls.find((c) => c.path.endsWith('/tutor/earnings'))?.params.get('month')).toBe(currentMonth());

    const empty = shiftMonth(currentMonth(), -3);
    await pickMonth(user, empty);
    expect(await screen.findByText('Chưa có buổi dạy nào trong tháng này')).toBeInTheDocument();
    expect(screen.getByText('Số buổi đã dạy', { selector: '.ant-statistic-title' }).closest('.ant-statistic')).toHaveTextContent('0');
    expect(screen.getByText('Không có buổi nào khớp bộ lọc')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/items') && c.params.get('month') === empty)).toBe(true);
  });

  it('shows previous-month cancelled sessions in the collapsed section', async () => {
    const { user } = await loginAndGo(APPROVED, EARNINGS);
    await screen.findByText(vnd('683.333 ₫'));
    await pickMonth(user, shiftMonth(currentMonth(), -1));
    const toggle = await screen.findByRole('button', { name: /Buổi bị huỷ\/hoàn tiền \(1\)/ });
    await user.click(toggle);
    expect(await screen.findByText('Lý do: Bận đột xuất')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn tiền')).toBeInTheDocument();
  });

  it('shows an error with a retry button, then recovers', async () => {
    server.use(
      http.get('/api/v1/tutor/earnings', () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }), { once: true }),
    );
    const { user } = await loginAndGo(APPROVED, EARNINGS);
    expect(await screen.findByText('Không tải được số liệu thu nhập.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(vnd('683.333 ₫'))).toBeInTheDocument();
  });

  it('filters by settlement and sends the parameter', async () => {
    const calls = recordCalls();
    const { user } = await loginAndGo(APPROVED, EARNINGS);
    const table = await screen.findByRole('table', { name: 'Các buổi dạy tính vào thu nhập' });
    await within(table).findAllByText(/^BK-000[123]$/);
    await user.click(screen.getByRole('radio', { name: 'Chưa đối soát' }));
    await waitFor(() => expect(within(table).queryByText('BK-0001')).not.toBeInTheDocument());
    expect(within(table).getAllByText(/^BK-000[23]$/)).toHaveLength(2);
    expect(calls.some((c) => c.path.endsWith('/items') && c.params.get('settlement') === 'unsettled' && c.params.get('page') === '1')).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Đã đối soát' }));
    await waitFor(() => expect(within(table).getByText('BK-0001')).toBeInTheDocument());
    expect(within(table).getAllByText('Đã đối soát')).toHaveLength(1);
  });

  it('sorts and paginates through the API', async () => {
    const calls = recordCalls();
    const month = currentMonth();
    server.use(
      http.get('/api/v1/tutor/earnings/items', ({ request }) => {
        const q = new URL(request.url).searchParams;
        const page = Number(q.get('page') ?? 1);
        const n = (i: number) => ({
          bookingId: `60000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          code: `BK-P${String(i).padStart(3, '0')}`,
          studentName: 'Học viên',
          startAt: '2026-11-02T03:00:00.000Z',
          endAt: '2026-11-02T04:00:00.000Z',
          priceVnd: 100_000,
          platformFeeVnd: 10_000,
          netVnd: 90_000,
          settled: false,
          settledAt: null,
        });
        const all = Array.from({ length: 25 }, (_, i) => n(i + 1));
        return HttpResponse.json({ month, page, pageSize: 10, total: 25, items: all.slice((page - 1) * 10, page * 10), cancelled: [], adjustments: [] });
      }),
    );
    const { user } = await loginAndGo(APPROVED, EARNINGS);
    expect(await screen.findByText('BK-P001')).toBeInTheDocument();
    await user.click(screen.getByRole('listitem', { name: '2' }));
    expect(await screen.findByText('BK-P011')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/items') && c.params.get('page') === '2' && c.params.get('pageSize') === '10')).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Sắp xếp' }));
    await user.click(await screen.findByTitle('Cũ nhất trước'));
    await waitFor(() => expect(calls.some((c) => c.params.get('sort') === 'startAt:asc' && c.params.get('page') === '1')).toBe(true));
  });
});
