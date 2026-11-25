import { Button, Space, Tag } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { BookingStatus } from '../../api/types';
import labels from './vi.json';
import './calendar.css';

export interface CalendarSession {
  id: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  title: string;
  href: string;
}

export function monday(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const colors: Record<BookingStatus, string> = {
  CONFIRMED: 'green', PENDING_PAYMENT: 'gold', EXPIRED: 'default',
  CANCELLED_BY_STUDENT: 'red', CANCELLED_BY_TUTOR: 'red', CANCELLED_BY_ADMIN: 'red',
};

/** Native date arithmetic and Intl use the browser's timezone, including DST changes. */
export default function WeekCalendar({ sessions, initialDate = new Date(), role }: {
  sessions: CalendarSession[];
  initialDate?: Date;
  role: 'student' | 'tutor';
}) {
  const { t, i18n } = useTranslation();
  const [start, setStart] = useState(() => monday(initialDate));
  const locale = i18n.language || 'vi';
  const dateFormat = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: '2-digit' });
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <section aria-label={labels.week}>
      <Space wrap className="week-toolbar">
        <Button aria-label={labels.previous} onClick={() => setStart(addDays(start, -7))}>‹</Button>
        <Button onClick={() => setStart(monday(new Date()))}>{labels.today}</Button>
        <Button aria-label={labels.next} onClick={() => setStart(addDays(start, 7))}>›</Button>
        <strong aria-live="polite">{dateFormat.format(start)} – {dateFormat.format(days[6])}</strong>
        <span>{timezone}</span>
      </Space>
      <div className="week-grid">
        {days.map((day) => {
          const next = addDays(day, 1);
          const events = sessions.filter((session) => new Date(session.startAt) < next && new Date(session.endAt) > day)
            .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
          return (
            <section className="week-day" key={day.toISOString()} aria-label={dateFormat.format(day)}>
              <h4 className={day.toDateString() === new Date().toDateString() ? 'week-today' : undefined}>{dayFormat.format(day)}</h4>
              {events.length === 0 && <p className="week-empty">{labels.empty}</p>}
              <div className="week-events">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div className="week-hour" key={hour} style={{ gridRow: hour + 1 }}>
                    <span className="week-hour-label">{String(hour).padStart(2, '0')}:00</span>
                    {events.filter((session) => new Date(Math.max(Date.parse(session.startAt), day.getTime())).getHours() === hour).map((session) => (
                      <Link key={session.id} className={`week-event week-event-${session.status}`} to={session.href}>
                        <strong>{timeFormat.format(new Date(session.startAt))}–{timeFormat.format(new Date(session.endAt))}</strong>
                        <span>{session.title}</span>
                        <Tag color={colors[session.status]}>{t(`${role === 'student' ? 'myBookings.status' : 'tutorSessions.bookingStatus'}.${session.status}`)}</Tag>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
