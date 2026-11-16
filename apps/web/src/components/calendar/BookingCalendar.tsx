import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/endpoints';
import type { Booking, StudentScope, TutorBooking } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { ErrorState } from '../States';
import WeekCalendar from './WeekCalendar';

/** Existing APIs accept scope and pagination, but no date filter. Read every page. */
export async function loadCalendarBookings<T>(load: (page: number) => Promise<{ items: T[]; total: number }>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const result = await load(page);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
  }
}

export default function BookingCalendar({ role, scope }: { role: 'student' | 'tutor'; scope: StudentScope }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: [role === 'student' ? 'student' : 'my', 'bookings', scope, 'calendar'],
    queryFn: ({ signal }) => loadCalendarBookings<Booking | TutorBooking>((page) => role === 'student'
      ? api.listMyBookings(scope, page, 100, signal)
      : api.listMyTeachingBookings(scope, page, 100, signal)),
  });
  if (query.isPending) return <Spin />;
  if (query.isError) return <ErrorState message={t(role === 'student' ? 'myBookings.loadError' : 'tutorSessions.loadError')} onRetry={() => void query.refetch()} />;
  return <WeekCalendar sessions={query.data.map((booking) => ({
    ...booking,
    title: 'tutor' in booking ? booking.tutor.fullName : booking.student.fullName,
    href: role === 'student' ? ROUTES.booking(booking.id) : ROUTES.tutorSession(booking.id),
  }))} />;
}
