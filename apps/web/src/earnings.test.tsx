import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { formatMonth, monthKey } from './lib/time';
import { server } from './mocks/server';
import { renderApp } from './test/render';

const APPROVED = 'giasu-duyet@example.test';
const mainButton = (name: string) => within(screen.getByRole('main')).getByRole('button', { name });

async function openEarnings() {
  const user = userEvent.setup();
  const { router } = renderApp('/dang-nhap');
  await user.type(await screen.findByLabelText('Email'), APPROVED);
  await user.type(screen.getByLabelText('Mật khẩu'), 'mock-pass-1234');
  await user.click(mainButton('Đăng nhập'));
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/dang-nhap'));
  await router.navigate('/gia-su/thu-nhap');
  return user;
}

const item = (n: number, settled: boolean) => ({
  bookingId: `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  code: `BK-${n}`, studentName: `HV ${n}`,
  startAt: '2026-06-10T03:00:00.000Z', endAt: '2026-06-10T04:00:00.000Z',
  priceVnd: 200_000, platformFeeVnd: 20_000, netVnd: 180_000, settled, settledAt: settled ? '2026-07-01T00:00:00.000Z' : null,
});

describe('tutor earnings (S-29/S-30)', () => {
  it('renders the figures from the API and the fee note', async () => {
    await openEarnings();
    expect(await screen.findByText('Phí nền tảng là 10% giá buổi.', { exact: false })).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'Thu nhập' });
    expect(within(stats).getByText('Số buổi đã dạy').closest('li')).toHaveTextContent('3');
    expect(within(stats).getByText('Tổng tiền thu').closest('li')).toHaveTextContent('683.333 ₫');
    expect(within(stats).getByText('Phí nền tảng').closest('li')).toHaveTextContent('68.333 ₫');
    expect(within(stats).getByText('Thực nhận').closest('li')).toHaveTextContent('615.000 ₫');
    const settledCard = within(stats).getByText('Đã đối soát').closest('li');
    expect(settledCard).toHaveTextContent('180.000 ₫');
    expect(settledCard).toHaveTextContent('Chưa đối soát');
    expect(settledCard).toHaveTextContent('435.000 ₫');
    expect(await screen.findByText('BK-9001')).toBeInTheDocument();
    expect(screen.getByText('Buổi bị huỷ/hoàn tiền', { exact: false })).toBeInTheDocument();
  });

  it('shows the empty state for a month without sessions', async () => {
    const calls: string[] = [];
    server.use(http.get('/api/v1/tutor/earnings', ({ request }) => {
      calls.push(new URL(request.url).searchParams.get('month') ?? '');
      return HttpResponse.json({ month: monthKey(1), timezone: 'Asia/Ho_Chi_Minh', isEmpty: true, sessionCount: 0, grossVnd: 0, platformFeeVnd: 0, netVnd: 0, settledNetVnd: 0, unsettledNetVnd: 0, feeRate: 0.1, adjustmentsVnd: 0, adjustmentCount: 0 });
    }));
    const user = await openEarnings();
    await user.click(await screen.findByRole('combobox', { name: 'Chọn tháng (tối đa 24 tháng gần nhất)' }));
    await user.click(await screen.findByTitle(formatMonth(monthKey(1))));
    expect(await screen.findByText('Chưa có buổi dạy nào trong tháng này')).toBeInTheDocument();
    expect(calls).toContain(monthKey(1));
  });

  it('shows an error with retry', async () => {
    let fail = true;
    server.use(http.get('/api/v1/tutor/earnings', () => (fail
      ? HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 })
      : HttpResponse.json({ month: monthKey(), timezone: 'Asia/Ho_Chi_Minh', isEmpty: false, sessionCount: 1, grossVnd: 1_234_000, platformFeeVnd: 123_400, netVnd: 1_110_600, settledNetVnd: 0, unsettledNetVnd: 1_110_600, feeRate: 0.1, adjustmentsVnd: 0, adjustmentCount: 0 }))));
    const user = await openEarnings();
    expect(await screen.findByText('Không tải được thu nhập.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getAllByRole('button', { name: 'Thử lại' })[0]);
    expect(await screen.findByText('1.234.000 ₫')).toBeInTheDocument();
  });

  it('passes the settlement filter and page to the API', async () => {
    const queries: URLSearchParams[] = [];
    server.use(http.get('/api/v1/tutor/earnings/items', ({ request }) => {
      const q = new URL(request.url).searchParams;
      queries.push(q);
      const page = Number(q.get('page'));
      const rows = page === 1 ? Array.from({ length: 10 }, (_, i) => item(i + 1, false)) : [item(11, false)];
      return HttpResponse.json({ month: monthKey(), page, pageSize: 10, total: 11, items: rows, cancelled: [], adjustments: [] });
    }));
    const user = await openEarnings();
    expect(await screen.findByText('BK-1')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Chưa đối soát' }));
    await waitFor(() => expect(queries.at(-1)?.get('settlement')).toBe('unsettled'));
    expect(queries.at(-1)?.get('month')).toBe(monthKey());
    await user.click(await screen.findByRole('listitem', { name: '2' }));
    expect(await screen.findByText('BK-11')).toBeInTheDocument();
    expect(queries.at(-1)?.get('page')).toBe('2');
    expect(queries.at(-1)?.get('settlement')).toBe('unsettled');
  });
});
