import { Button, Card, List, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMyTeachingBookings } from '../../api/hooks';
import type { TeachingScope, TutorBooking } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { EmptyState, ErrorState } from '../../components/States';
import { formatDate, formatTimeRange } from '../../lib/time';

const PAGE_SIZE = 10;
const SCOPES: TeachingScope[] = ['upcoming', 'past', 'cancelled'];

export function BookingStatusTag({ booking }: { booking: TutorBooking }) {
  const { t } = useTranslation();
  const color = booking.status === 'CONFIRMED' ? 'green' : booking.status.startsWith('CANCELLED') ? 'red' : 'default';
  return <Tag color={color}>{t(`tutorSessions.bookingStatus.${booking.status}`)}</Tag>;
}

function SessionList({ scope }: { scope: TeachingScope }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useMyTeachingBookings(scope, page, PAGE_SIZE);

  if (query.isPending) return <List loading dataSource={[]} />;
  if (query.isError) return <ErrorState message={t('tutorSessions.loadError')} onRetry={() => void query.refetch()} />;
  if (query.data.total === 0) return <EmptyState title={t('tutorSessions.empty')} hint={t('tutorSessions.emptyHint')} />;

  return (
    <List
      dataSource={query.data.items}
      pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
      renderItem={(b) => (
        <List.Item
          actions={[
            <Link key="detail" to={ROUTES.tutorSession(b.id)}>
              <Button size="small">{t('tutorSessions.detail')}</Button>
            </Link>,
          ]}
        >
          <div>
            <strong>{formatDate(b.startAt)} {formatTimeRange(b.startAt, b.endAt)}</strong>
            <Typography.Text> · {b.student.fullName}</Typography.Text> <BookingStatusTag booking={b} />
          </div>
        </List.Item>
      )}
    />
  );
}

/** S-20: upcoming / past / cancelled teaching sessions. */
export default function TutorSessionsPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <Typography.Title level={3}>{t('tutorSessions.title')}</Typography.Title>
      <Tabs
        destroyInactiveTabPane
        items={SCOPES.map((scope) => ({ key: scope, label: t(`tutorSessions.${scope}`), children: <SessionList scope={scope} /> }))}
      />
    </Card>
  );
}
