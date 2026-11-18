import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
  it.each(['student', 'tutor'] as const)('uses existing %s detail links and API scope', async (role) => {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const method = role === 'student' ? 'listMyBookings' : 'listMyTeachingBookings';
    const spy = vi.spyOn(api, method).mockResolvedValue({ items: [{
      id: 'calendar-one', startAt: now.toISOString(), endAt: new Date(now.getTime() + 3600000).toISOString(),
      status: 'CONFIRMED', ...(role === 'student' ? { tutor: { fullName: 'Calendar Tutor' } } : { student: { fullName: 'Calendar Student' } }),
    }], total: 1 } as never);
    renderQuery(<BookingCalendar role={role} scope="past" />);
    const link = await screen.findByRole('link', { name: /Calendar/ });
    expect(link).toHaveAttribute('href', role === 'student' ? '/lich-cua-toi/calendar-one' : '/gia-su/buoi-day/calendar-one');
    expect(spy).toHaveBeenCalledWith('past', 1, 100, expect.anything());
  });

  it.each(['student', 'tutor'] as const)('switches %s from the existing list to the weekly calendar', async (role) => {
    vi.spyOn(api, role === 'student' ? 'listMyBookings' : 'listMyTeachingBookings').mockResolvedValue({ items: [], total: 0 } as never);
    renderQuery(role === 'student' ? <MyBookingsPage /> : <TutorSessionsPage />);
    expect(screen.queryByRole('region', { name: 'Lịch tuần' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Lịch tuần'));
    expect(await screen.findByRole('region', { name: 'Lịch tuần' })).toBeInTheDocument();
    await userEvent.click(screen.getByText('Danh sách'));
    expect(screen.queryByRole('region', { name: 'Lịch tuần' })).not.toBeInTheDocument();
  });
});
