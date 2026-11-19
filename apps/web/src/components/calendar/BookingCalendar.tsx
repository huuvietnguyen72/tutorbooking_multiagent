import { useQueries } from '@tanstack/react-query';
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

const SCOPES: StudentScope[] = ['upcoming', 'past', 'cancelled'];

/** The calendar shows the viewed week regardless of status: every scope is loaded and merged by id. */
export default function BookingCalendar({ role }: { role: 'student' | 'tutor' }) {
  const { t } = useTranslation();
  const queries = useQueries({
    queries: SCOPES.map((scope) => ({
      queryKey: [role === 'student' ? 'student' : 'my', 'bookings', scope, 'calendar'],
      queryFn: ({ signal }: { signal: AbortSignal }) => loadCalendarBookings<Booking | TutorBooking>((page) => role === 'student'
        ? api.listMyBookings(scope, page, 100, signal)
        : api.listMyTeachingBookings(scope, page, 100, signal)),
    })),
  });
  if (queries.some((q) => q.isError)) return <ErrorState message={t(role === 'student' ? 'myBookings.loadError' : 'tutorSessions.loadError')} onRetry={() => queries.forEach((q) => { if (q.isError) void q.refetch(); })} />;
  if (queries.some((q) => q.isPending)) return <Spin />;
  const byId = new Map<string, Booking | TutorBooking>();
  for (const q of queries) for (const booking of q.data ?? []) byId.set(booking.id, booking);
  return <WeekCalendar sessions={[...byId.values()].map((booking) => ({
    ...booking,
    title: 'tutor' in booking ? booking.tutor.fullName : booking.student.fullName,
    href: role === 'student' ? ROUTES.booking(booking.id) : ROUTES.tutorSession(booking.id),
  }))} />;
}
