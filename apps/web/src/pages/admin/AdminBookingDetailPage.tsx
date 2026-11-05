import { Alert, Button, Card, Descriptions, Radio, Skeleton, Space, Table, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useAdminBooking, useAdminCancelBooking, useAdminRefundPayment } from '../../api/hooks';
import type { AdminBookingDetail } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { ReasonModal } from '../../components/ReasonModal';
import { formatVnd } from '../../lib/format';
import { formatDate, formatDateTime, formatTimeRange } from '../../lib/time';
import { AdminBookingStatusTag, PaymentStatusTag } from './AdminBookingsPage';
import { AuditLogTable } from './AuditLogTable';

function CancelModal({ booking, onClose }: { booking: AdminBookingDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useAdminCancelBooking(booking.id);
  const [refund, setRefund] = useState(true);
  return (
    <ReasonModal
      title={t('admin.booking.cancelTitle', { code: booking.code })}
      okText={t('admin.booking.cancelConfirm')}
      warning={t('admin.booking.cancelWarning')}
      danger
      onSubmit={async (reason) => {
        await cancel.mutateAsync({ reason, refund });
        void message.success(t('admin.booking.cancelled'));
      }}
      onClose={onClose}
    >
      <Radio.Group value={refund} onChange={(e) => setRefund(e.target.value as boolean)} aria-label={t('admin.booking.refundChoice')}>
        <Space direction="vertical">
          <Radio value>{t('admin.booking.refundFull')}</Radio>
          <Radio value={false}>{t('admin.booking.refundNone')}</Radio>
        </Space>
      </Radio.Group>
    </ReasonModal>
  );
}

/** S-28: booking detail with payment events, status history, audit trail, cancel and manual refund. */
export default function AdminBookingDetailPage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const query = useAdminBooking(bookingId);
  const refund = useAdminRefundPayment();
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);

  const back = <Link to={ROUTES.adminBookings}>‹ {t('admin.booking.back')}</Link>;
  if (query.isPending) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <StatusPage status="404" extra={<Link to={ROUTES.adminBookings}><Button type="primary">{t('admin.booking.back')}</Button></Link>} />;
    }
    return <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />;
  }

  const b = query.data;
  const cancelled = b.status.startsWith('CANCELLED');
  const canCancel = b.status === 'CONFIRMED' && Date.parse(b.startAt) > Date.now();
  // Refund rule (architecture §2.4): PAID payment on a cancelled booking, or a CONFIRMED booking that already took place.
  const canRefund = b.payment.status === 'PAID' && (cancelled || (b.status === 'CONFIRMED' && !!b.isFinished));

  return (
    <>
      {back}
      <Card style={{ marginTop: 12 }}>
        <Typography.Title level={3}>
          {t('admin.booking.title', { code: b.code })} <AdminBookingStatusTag status={b.status} />
        </Typography.Title>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('admin.bookings.student')}>{b.student.fullName} · {b.studentEmail}</Descriptions.Item>
          <Descriptions.Item label={t('admin.bookings.tutor')}>{b.tutor.fullName} · {b.tutorEmail}</Descriptions.Item>
          <Descriptions.Item label={t('admin.bookings.time')}>{formatDate(b.startAt)} {formatTimeRange(b.startAt, b.endAt)}</Descriptions.Item>
          <Descriptions.Item label={t('admin.bookings.amount')}>{formatVnd(b.priceVnd)}</Descriptions.Item>
          <Descriptions.Item label={t('admin.bookings.payment')}>
            <PaymentStatusTag payment={b.payment} />
            {b.payment.paidAt ? <div>{t('admin.booking.paidAt', { time: formatDateTime(b.payment.paidAt) })}</div> : null}
            {b.payment.refundedAt ? (
              <div>
                {t('admin.booking.refundedAt', { time: formatDateTime(b.payment.refundedAt) })}
                {b.payment.refundedByName ? ` ${t('admin.booking.refundedBy', { name: b.payment.refundedByName })}` : ''}
              </div>
            ) : null}
          </Descriptions.Item>
          {b.cancelledAt ? (
            <Descriptions.Item label={t('admin.booking.cancelInfo')}>
              {t('admin.booking.cancelledAt', { time: formatDateTime(b.cancelledAt) })}
              {b.cancelReason ? <div>{t('admin.booking.cancelReason', { reason: b.cancelReason })}</div> : null}
            </Descriptions.Item>
          ) : null}
        </Descriptions>

        {b.payment.refundFailed ? <Alert type="error" showIcon style={{ marginTop: 16 }} message={t('admin.booking.refundFailedHint')} /> : null}
        {refund.isError ? <Alert type="error" showIcon role="alert" style={{ marginTop: 16 }} message={errorText(refund.error)} /> : null}

        <Space style={{ marginTop: 16 }}>
          {canCancel ? <Button danger onClick={() => setCancelling(true)}>{t('admin.booking.cancelButton')}</Button> : null}
          {canRefund ? <Button type="primary" onClick={() => setRefunding(true)}>{t('admin.booking.refundButton')}</Button> : null}
        </Space>
        {!canRefund && b.payment.status === 'REFUNDED' && b.payment.refundedAt ? (
          <div>
            <Button disabled style={{ marginTop: 8 }}>
              {t('admin.booking.refundedAt', { time: formatDateTime(b.payment.refundedAt) })}
              {b.payment.refundedByName ? ` ${t('admin.booking.refundedBy', { name: b.payment.refundedByName })}` : ''}
            </Button>
          </div>
        ) : null}

        <Typography.Title level={5} style={{ marginTop: 24 }}>{t('admin.booking.history')}</Typography.Title>
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          pagination={false}
          dataSource={b.history ?? []}
          locale={{ emptyText: t('admin.booking.noHistory') }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.audit.time'), dataIndex: 'createdAt', render: (v?: string) => (v ? formatDateTime(v) : '') },
            {
              title: t('admin.booking.transition'),
              render: (_, h) => `${h.fromStatus ? t(`admin.bookingStatus.${h.fromStatus}`, { defaultValue: h.fromStatus }) : '—'} → ${t(`admin.bookingStatus.${h.toStatus ?? ''}`, { defaultValue: h.toStatus ?? '' })}`,
            },
            { title: t('admin.booking.actor'), dataIndex: 'actorType', render: (v?: string) => (v ? t(`admin.actorType.${v}`, { defaultValue: v }) : '') },
            { title: t('admin.booking.note'), dataIndex: 'note', render: (v?: string | null) => v ?? '' },
          ]}
        />

        <Typography.Title level={5} style={{ marginTop: 24 }}>{t('admin.booking.paymentEvents')}</Typography.Title>
        <Table
          size="small"
          rowKey="eventId"
          pagination={false}
          dataSource={b.paymentEvents ?? []}
          locale={{ emptyText: t('admin.booking.noPaymentEvents') }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.audit.time'), dataIndex: 'receivedAt', render: (v?: string) => (v ? formatDateTime(v) : '') },
            { title: t('admin.booking.eventId'), dataIndex: 'eventId' },
            { title: t('admin.booking.outcome'), dataIndex: 'outcome' },
            { title: t('admin.booking.rejectedReason'), dataIndex: 'rejectedReason', render: (v?: string | null) => v ?? '' },
          ]}
        />

        <Typography.Title level={5} style={{ marginTop: 24 }}>{t('admin.booking.auditTrail')}</Typography.Title>
        <AuditLogTable filter={{ entityType: 'booking', entityId: b.id }} />
        <AuditLogTable filter={{ entityType: 'payment', entityId: b.payment.id }} />
      </Card>

      {cancelling ? <CancelModal booking={b} onClose={() => setCancelling(false)} /> : null}
      {refunding ? (
        <ReasonModal
          title={t('admin.booking.refundTitle', { amount: formatVnd(b.payment.amountVnd) })}
          okText={t('admin.booking.refundConfirm')}
          warning={t('admin.booking.refundWarning')}
          onSubmit={async (reason) => {
            const result = await refund.mutateAsync({ paymentId: b.payment.id, reason });
            // The provider can fail while the API still answers 200: the payment stays PAID with `refundFailed`.
            if (result.refundFailed) void message.error(t('admin.booking.refundProviderFailed'));
            else void message.success(t('admin.booking.refunded'));
          }}
          onClose={() => setRefunding(false)}
        />
      ) : null}
    </>
  );
}
