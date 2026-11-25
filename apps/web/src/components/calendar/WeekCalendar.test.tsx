import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import '../../i18n';
import WeekCalendar, { monday, type CalendarSession } from './WeekCalendar';
import { loadCalendarBookings } from './BookingCalendar';

const date = new Date(2026, 10, 16, 9);
const session: CalendarSession = {
  id: 'one', title: 'Tutor One', status: 'CONFIRMED',
  startAt: new Date(2026, 10, 16, 9, 30).toISOString(),
  endAt: new Date(2026, 10, 16, 10, 30).toISOString(), href: '/detail/one',
};
function setup(sessions = [session], role: 'student' | 'tutor' = 'student') {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<WeekCalendar initialDate={date} sessions={sessions} role={role} />} />
    <Route path="/detail/one" element={<p>Booking detail</p>} />
  </Routes></MemoryRouter>);
}

describe('weekly booking calendar', () => {
  it('renders seven days, local times, status and opens the existing detail route', async () => {
    const { container } = setup();
    expect(container.querySelectorAll('.week-day')).toHaveLength(7);
    expect(screen.getByText('09:30–10:30')).toBeInTheDocument();
    expect(container.querySelector('.week-event-CONFIRMED')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /Tutor One/ }));
    expect(screen.getByText('Booking detail')).toBeInTheDocument();
  });

  it('moves both ways across weeks and returns to today', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Tuần sau' }));
    expect(screen.queryByText('Tutor One')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tuần trước' }));
    expect(screen.getByText('Tutor One')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tuần trước' }));
    expect(screen.queryByText('Tutor One')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    const today = monday(new Date());
    const label = new Intl.DateTimeFormat('vi', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(today);
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
  });

  it('labels cancellations from the viewer perspective', () => {
    const cancelledByTutor = { ...session, id: 'by-tutor', status: 'CANCELLED_BY_TUTOR' as const };
    const cancelledByStudent = { ...session, id: 'by-student', status: 'CANCELLED_BY_STUDENT' as const };
    const { unmount } = setup([cancelledByTutor, cancelledByStudent], 'student');
    expect(screen.getByText('Đã huỷ bởi gia sư')).toBeInTheDocument();
    expect(screen.getByText('Đã huỷ bởi bạn')).toBeInTheDocument();
    unmount();
    setup([cancelledByTutor, cancelledByStudent], 'tutor');
    expect(screen.getByText('Bạn đã huỷ')).toBeInTheDocument();
    expect(screen.getByText('Học viên đã huỷ')).toBeInTheDocument();
  });

  it('groups UTC timestamps by local date, including sessions spanning midnight', () => {
    const overnight = { ...session, startAt: new Date(2026, 10, 16, 23, 30).toISOString(), endAt: new Date(2026, 10, 17, 0, 30).toISOString() };
    const { container } = setup([overnight]);
    const days = container.querySelectorAll('.week-day');
    expect(within(days[0] as HTMLElement).getByText('Tutor One')).toBeInTheDocument();
    expect(within(days[1] as HTMLElement).getByText('Tutor One')).toBeInTheDocument();
    expect(within(days[2] as HTMLElement).queryByText('Tutor One')).not.toBeInTheDocument();
  });

  it('loads all API pages rather than dropping bookings beyond the first page', async () => {
    const calls: number[] = [];
    const result = await loadCalendarBookings(async (page) => {
      calls.push(page);
      return { items: [page], total: 3 };
    });
    expect(result).toEqual([1, 2, 3]);
    expect(calls).toEqual([1, 2, 3]);
  });
});
