import { Button, Card, List, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useStudentBookings } from '../../api/hooks';
import type { Booking, StudentScope } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { EmptyState, ErrorState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatDateTime, formatSession, formatTime } from '../../lib/time';
import { BookingStatusTag } from './bookingCommon';
import ReviewModal from './ReviewModal';

const PAGE_SIZE = 10;
const SCOPES: StudentScope[] = ['upcoming', 'past', 'cancelled'];

function PaymentLine({ booking }: { booking: Booking }) {
  const { t } = useTranslation();
  if (booking.status === 'PENDING_PAYMENT') {
    return booking.holdExpiresAt ? <Typography.Text type="secondary">{t('myBookings.holdUntil', { time: formatTime(booking.holdExpiresAt) })}</Typography.Text> : null;
  }
  if (booking.payment.status === 'REFUNDED') {
    return <Typography.Text type="secondary">{t('myBookings.refunded', { amount: formatVnd(booking.payment.amountVnd) })}</Typography.Text>;
  }
  if (booking.payment.status === 'PAID') {
    return (
      <Typography.Text type="secondary">
        {t('myBookings.paymentLine', { status: `${t('myBookings.paymentStatus.PAID')} ${formatVnd(booking.payment.amountVnd)}` })}
      </Typography.Text>
    );
  }
  return null;
}

function BookingList({ scope }: { scope: StudentScope }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<Booking | null>(null);
  const query = useStudentBookings(scope, page, PAGE_SIZE);

  if (query.isPending) return <List loading dataSource={[]} />;
  if (query.isError) return <ErrorState message={t('myBookings.loadError')} onRetry={() => void query.refetch()} />;
  if (query.data.total === 0) {
    return scope === 'upcoming' ? (
      <EmptyState title={t('myBookings.emptyUpcoming')} action={<Link to={ROUTES.tutors}><Button type="primary">{t('myBookings.findTutor')}</Button></Link>} />
    ) : (
      <EmptyState title={t('myBookings.emptyOther')} />
    );
  }

  return (
    <>
      <List
        dataSource={query.data.items}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
        renderItem={(b) => (
          <List.Item
            actions={[
              b.status === 'PENDING_PAYMENT' ? (
                <Link key="pay" to={ROUTES.pay(b.id)}><Button size="small" type="primary">{t('myBookings.pay')}</Button></Link>
              ) : null,
              // The server decides whether a review is possible (`actions.review`), the UI only reflects it.
              b.actions?.review.allowed ? (
                <Button key="review" size="small" onClick={() => setReviewing(b)}>{t('myBookings.review')}</Button>
              ) : null,
              <Link key="detail" to={ROUTES.booking(b.id)}><Button size="small">{t('myBookings.detail')}</Button></Link>,
            ].filter(Boolean)}
          >
            <div>
              <strong>{formatSession(b.startAt, b.endAt)}</strong>
              <Typography.Text> · {b.tutor.fullName}</Typography.Text>
              <div>
                <Space size="middle" wrap>
                  <BookingStatusTag status={b.status} />
                  <PaymentLine booking={b} />
                </Space>
              </div>
              {b.cancelledAt ? (
                <Typography.Text type="secondary">{formatDateTime(b.cancelledAt)}</Typography.Text>
              ) : null}
            </div>
          </List.Item>
        )}
      />
      {reviewing ? <ReviewModal booking={reviewing} onClose={() => setReviewing(null)} /> : null}
    </>
  );
}

/** S-10: upcoming / past / cancelled-or-expired bookings. */
export default function MyBookingsPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <Typography.Title level={3}>{t('myBookings.title')}</Typography.Title>
      <Tabs
        destroyInactiveTabPane
        items={SCOPES.map((scope) => ({ key: scope, label: t(`myBookings.${scope}`), children: <BookingList scope={scope} /> }))}
      />
    </Card>
  );
}
