import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { api } from '../../api/endpoints';
import BookingCalendar from './BookingCalendar';
import MyBookingsPage from '../../pages/student/MyBookingsPage';
import TutorSessionsPage from '../../pages/tutor/TutorSessionsPage';

function renderQuery(element: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{element}</MemoryRouter>
  </QueryClientProvider>);
}
afterEach(() => vi.restoreAllMocks());

describe('booking calendar integration', () => {
  it.each(['student', 'tutor'] as const)('shows %s sessions of any status in the viewed week, merging every scope', async (role) => {
    const at = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(12, 0, 0, 0); return d; };
    const mk = (id: string, name: string, d: Date, status: string) => ({
      id, startAt: d.toISOString(), endAt: new Date(d.getTime() + 3600000).toISOString(), status,
      ...(role === 'student' ? { tutor: { fullName: name } } : { student: { fullName: name } }),
    });
    const byScope: Record<string, unknown[]> = {
      upcoming: [mk('u1', 'Calendar Upcoming', at(0), 'CONFIRMED')],
      past: [mk('p1', 'Calendar Past', at(-14), 'CONFIRMED')],
      cancelled: [mk('c1', 'Calendar Cancelled', at(14), 'CANCELLED_BY_STUDENT')],
    };
    const spy = vi.spyOn(api, role === 'student' ? 'listMyBookings' : 'listMyTeachingBookings')
      .mockImplementation((async (scope: string) => ({ items: byScope[scope], total: byScope[scope].length })) as never);
    renderQuery(<BookingCalendar role={role} />);
    const link = await screen.findByRole('link', { name: /Calendar Upcoming/ });
    expect(link).toHaveAttribute('href', role === 'student' ? '/lich-cua-toi/u1' : '/gia-su/buoi-day/u1');
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual(['cancelled', 'past', 'upcoming']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tuần trước' }));
    await user.click(screen.getByRole('button', { name: 'Tuần trước' }));
    expect(await screen.findByRole('link', { name: /Calendar Past/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    await user.click(screen.getByRole('button', { name: 'Tuần sau' }));
    await user.click(screen.getByRole('button', { name: 'Tuần sau' }));
    expect(await screen.findByRole('link', { name: /Calendar Cancelled/ })).toBeInTheDocument();
  });

  it.each(['student', 'tutor'] as const)('switches %s from the existing list to the weekly calendar', async (role) => {
    vi.spyOn(api, role === 'student' ? 'listMyBookings' : 'listMyTeachingBookings').mockResolvedValue({ items: [], total: 0 } as never);
    renderQuery(role === 'student' ? <MyBookingsPage /> : <TutorSessionsPage />);
    expect(screen.queryByRole('region', { name: 'Lịch tuần' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Lịch tuần'));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Lịch tuần' })).toBeInTheDocument();
    await userEvent.click(screen.getByText('Danh sách'));
    expect(screen.queryByRole('region', { name: 'Lịch tuần' })).not.toBeInTheDocument();
  });
});
