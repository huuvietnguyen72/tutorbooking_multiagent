import { Button, Card, Checkbox, DatePicker, Select, Space, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminBookings, useAdminUsers } from '../../api/hooks';
import type { Booking, BookingStatus } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { EmptyState, ErrorState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatDate, formatTimeRange, fromApiDate, toApiDate, toUtcIso } from '../../lib/time';

const PAGE_SIZE = 20;
const STATUSES: BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_TUTOR', 'CANCELLED_BY_ADMIN'];

export function AdminBookingStatusTag({ status }: { status: BookingStatus }) {
  const { t } = useTranslation();
  const color = status === 'CONFIRMED' ? 'green' : status.startsWith('CANCELLED') ? 'red' : 'default';
  return <Tag color={color}>{t(`admin.bookingStatus.${status}`)}</Tag>;
}

export function PaymentStatusTag({ payment }: { payment: Booking['payment'] }) {
  const { t } = useTranslation();
  return (
    <>
      <Tag color={payment.status === 'PAID' ? 'green' : payment.status === 'REFUNDED' ? 'blue' : 'default'}>
        {t(`admin.paymentStatus.${payment.status}`)}
      </Tag>
      {payment.refundFailed ? <Tag color="red">{t('admin.bookings.refundFailed')}</Tag> : null}
    </>
  );
}

/** S-27: booking list. Filters live in the URL so the dashboard can deep-link (e.g. `?refundFailed=true`). */
export default function AdminBookingsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [tutorSearch, setTutorSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const status = STATUSES.find((s) => s === params.get('status'));
  const refundFailed = params.get('refundFailed') === 'true';
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  // Reject normalization (e.g. February 30) and ignore the whole invalid range.
  const validDate = (value: string | null) => value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value, 'YYYY-MM-DD', true).isValid());
  const validRange = validDate(rawFrom) && validDate(rawTo) && !(rawFrom && rawTo && rawFrom > rawTo);
  const fromDate = validRange ? rawFrom ?? undefined : undefined;
  const toDate = validRange ? rawTo ?? undefined : undefined;
  const [upcomingFrom] = useState(() => new Date(Date.now() + 1).toISOString());
  const tutors = useAdminUsers({ role: 'TUTOR', q: tutorSearch || undefined, pageSize: 100 });
  const students = useAdminUsers({ role: 'STUDENT', q: studentSearch || undefined, pageSize: 100 });

  const query = useAdminBookings({
    status,
    refundFailed: refundFailed ? 'true' : undefined,
    // The picked days are GMT+7 calendar days: [from 00:00, to + 1 day 00:00).
    from: params.get('upcoming') === 'true' ? upcomingFrom : fromDate ? toUtcIso(fromDate, '00:00') : undefined,
    to: toDate ? toUtcIso(toApiDate(dayjsPlusDay(toDate)), '00:00') : undefined,
    tutorId: params.get('tutorId') ?? undefined,
    studentId: params.get('studentId') ?? undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  return (
    <Card>
      <Typography.Title level={3}>{t('admin.bookings.title')}</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          aria-label={t('admin.bookings.status')}
          placeholder={t('admin.bookings.status')}
          value={status}
          onChange={(v) => setFilter('status', v)}
          style={{ width: 200 }}
          options={STATUSES.map((s) => ({ value: s, label: t(`admin.bookingStatus.${s}`) }))}
        />
        {([
          ['tutorId', 'tutor', tutors],
          ['studentId', 'student', students],
        ] as const).map(([key, label, users]) => (
          <Select
            key={key}
            allowClear
            showSearch
            filterOption={false}
            onSearch={key === 'tutorId' ? setTutorSearch : setStudentSearch}
            aria-label={t(`admin.bookings.${label}`)}
            placeholder={t(`admin.bookings.${label}`)}
            value={params.get(key) ?? undefined}
            onChange={(value) => setFilter(key, value)}
            loading={users.isPending}
            style={{ width: 220 }}
            options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.fullName} · ${u.email}` }))}
          />
        ))}
        <DatePicker.RangePicker
          allowClear
          format="DD/MM/YYYY"
          value={fromDate && toDate ? [fromApiDate(fromDate), fromApiDate(toDate)] : null}
          placeholder={[t('admin.bookings.fromDate'), t('admin.bookings.toDate')]}
          onChange={(range: [Dayjs | null, Dayjs | null] | null) => {
            const next = new URLSearchParams(params);
            if (range?.[0] && range[1]) {
              next.set('from', toApiDate(range[0]));
              next.set('to', toApiDate(range[1]));
            } else {
              next.delete('from');
              next.delete('to');
            }
            setParams(next, { replace: true });
            setPage(1);
          }}
        />
        <Checkbox checked={refundFailed} onChange={(e) => setFilter('refundFailed', e.target.checked ? 'true' : undefined)}>
          {t('admin.bookings.onlyRefundFailed')}
        </Checkbox>
      </Space>
      {query.isError ? (
        <ErrorState message={t('admin.bookings.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<Booking>
          rowKey="id"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: <EmptyState title={t('admin.bookings.empty')} /> }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.bookings.code'), dataIndex: 'code' },
            { title: t('admin.bookings.student'), render: (_, b) => b.student.fullName },
            { title: t('admin.bookings.tutor'), render: (_, b) => b.tutor.fullName },
            { title: t('admin.bookings.time'), render: (_, b) => `${formatDate(b.startAt)} ${formatTimeRange(b.startAt, b.endAt)}` },
            { title: t('admin.bookings.amount'), render: (_, b) => formatVnd(b.priceVnd) },
            { title: t('admin.bookings.statusCol'), render: (_, b) => <AdminBookingStatusTag status={b.status} /> },
            { title: t('admin.bookings.payment'), render: (_, b) => <PaymentStatusTag payment={b.payment} /> },
            {
              title: t('admin.actions'),
              render: (_, b) => (
                <Link to={ROUTES.adminBooking(b.id)}>
                  <Button size="small">{t('admin.bookings.detail')}</Button>
                </Link>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function dayjsPlusDay(date: string): Dayjs {
  return fromApiDate(date).add(1, 'day');
}
