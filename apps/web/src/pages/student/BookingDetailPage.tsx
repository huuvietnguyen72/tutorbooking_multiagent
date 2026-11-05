import { Alert, Button, Card, Descriptions, List, Rate, Skeleton, Space, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useResumeCheckoutRedirect } from './useResumeCheckoutRedirect';
import { usePublicConfig, useStudentBooking } from '../../api/hooks';
import type { Booking, ReasonCode } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatCountdown, formatDateTime, formatSession } from '../../lib/time';
import { useCountdown } from '../../lib/useCountdown';
import { BookingStatusTag, isNotFound } from './bookingCommon';
import CancelModal from './CancelModal';
import ReviewModal from './ReviewModal';

/** A disabled-but-visible action with the server's `reasonCode` explained in a tooltip and an inline note. */
function ActionButton({ label, allowed, reason, onClick, danger, to }: {
  label: string;
  allowed: boolean;
  reason?: string;
  onClick?: () => void;
  danger?: boolean;
  to?: string;
}) {
  const button = <Button danger={danger} disabled={!allowed} onClick={onClick}>{label}</Button>;
  return (
    <Tooltip title={!allowed ? reason : undefined}>
      {/* wrapper keeps the tooltip working on a disabled button */}
      <span>{allowed && to ? <Link to={to}>{button}</Link> : button}</span>
    </Tooltip>
  );
}

function Actions({ booking, hours }: { booking: Booking; hours: number | undefined }) {
  const { t } = useTranslation();
  const [cancelling, setCancelling] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const resume = useResumeCheckoutRedirect(booking.id);
  const remaining = useCountdown(booking.status === 'PENDING_PAYMENT' ? booking.holdExpiresAt : null, booking.serverTime);
  const actions = booking.actions;

  const why = (code: ReasonCode | null | undefined) => (code ? t(`bookingDetail.disabled.${code}`, { hours: hours ?? '' }) : undefined);

  if (booking.status === 'PENDING_PAYMENT') {
    return (
      <>
        <p>⏱ {t('bookingDetail.holdLeft', { time: formatCountdown(remaining ?? 0) })}</p>
        <Space>
          <Button type="primary" loading={resume.isPending} onClick={() => resume.run()}>{t('bookingDetail.continuePay')}</Button>
          <ActionButton label={t('bookingDetail.cancelPending')} allowed={actions?.cancel.allowed ?? true} reason={why(actions?.cancel.reasonCode)} onClick={() => setCancelling(true)} />
        </Space>
        {cancelling ? <CancelModal booking={booking} onClose={() => setCancelling(false)} /> : null}
      </>
    );
  }

  if (booking.status !== 'CONFIRMED') return null;
  if (!actions) return null;

  // One explanation covers the common "inside the window" case so it is not repeated per button.
  const blockedReason = !actions.cancel.allowed ? actions.cancel.reasonCode : !actions.reschedule.allowed ? actions.reschedule.reasonCode : null;
  return (
    <>
      <Space wrap>
        <ActionButton label={t('bookingDetail.reschedule')} allowed={actions.reschedule.allowed} reason={why(actions.reschedule.reasonCode)} to={ROUTES.reschedule(booking.id)} />
        <ActionButton label={t('bookingDetail.cancel')} allowed={actions.cancel.allowed} reason={why(actions.cancel.reasonCode)} danger onClick={() => setCancelling(true)} />
        {booking.review ? null : (
          <ActionButton label={t('bookingDetail.review')} allowed={actions.review.allowed} reason={why(actions.review.reasonCode)} onClick={() => setReviewing(true)} />
        )}
      </Space>
      {blockedReason && blockedReason !== 'NOT_FINISHED' ? (
        <div style={{ marginTop: 8 }}><Typography.Text type="secondary">ⓘ {why(blockedReason)}</Typography.Text></div>
      ) : null}
      {!booking.review && !actions.review.allowed && actions.review.reasonCode === 'NOT_FINISHED' ? (
        <div style={{ marginTop: 8 }}><Typography.Text type="secondary">ⓘ {why('NOT_FINISHED')}</Typography.Text></div>
      ) : null}
      {cancelling ? <CancelModal booking={booking} onClose={() => setCancelling(false)} /> : null}
      {reviewing ? <ReviewModal booking={booking} onClose={() => setReviewing(false)} /> : null}
    </>
  );
}

/** S-11: details and the action block, driven entirely by `status` + `actions` from the API. */
export default function BookingDetailPage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const query = useStudentBooking(bookingId);
  const { data: config } = usePublicConfig();

  const back = <Link to={ROUTES.myBookings}>‹ {t('bookingDetail.back')}</Link>;
  if (query.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (query.isError) {
    if (isNotFound(query.error)) return <StatusPage status="404" extra={<Link to={ROUTES.myBookings}><Button type="primary">{t('bookingDetail.back')}</Button></Link>} />;
    return <ErrorState onRetry={() => void query.refetch()} />;
  }

  const b = query.data;
  const cancelled = b.status.startsWith('CANCELLED');
  const events = [
    b.payment.paidAt ? t('bookingDetail.paidEvent', { time: formatDateTime(b.payment.paidAt), amount: formatVnd(b.payment.amountVnd) }) : null,
    b.payment.refundedAt ? t('bookingDetail.refundEvent', { time: formatDateTime(b.payment.refundedAt), amount: formatVnd(b.payment.amountVnd) }) : null,
  ].filter((x): x is string => x !== null);

  return (
    <>
      {back}
      <Card style={{ marginTop: 12 }}>
        <Typography.Title level={3}>
          {t('bookingDetail.title', { code: b.code })} <BookingStatusTag status={b.status} />
        </Typography.Title>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('bookingDetail.tutor')}>{b.tutor.fullName}</Descriptions.Item>
          <Descriptions.Item label={t('bookingDetail.time')}>{formatSession(b.startAt, b.endAt)} ({t('app.timezoneNote')})</Descriptions.Item>
          <Descriptions.Item label={t('bookingDetail.fee')}>{formatVnd(b.priceVnd)}</Descriptions.Item>
          <Descriptions.Item label={t('bookingDetail.payment')}>{t(`myBookings.paymentStatus.${b.payment.status}`)}</Descriptions.Item>
          <Descriptions.Item label={t('bookingDetail.rescheduled')}>{b.rescheduleCount}/1</Descriptions.Item>
          {b.status === 'CONFIRMED' && !b.isFinished ? (
            <Descriptions.Item label={t('bookingDetail.deadlineLabel')}>{b.cancelDeadline ? formatDateTime(b.cancelDeadline) : '–'}</Descriptions.Item>
          ) : null}
        </Descriptions>

        {cancelled ? (
          <Alert
            style={{ marginTop: 16 }}
            type="error"
            showIcon
            message={t('bookingDetail.cancelledBy', { who: t(`bookingDetail.who.${b.status}`) })}
            description={
              <>
                {b.cancelReason ? <div>{t('bookingDetail.reasonLine', { reason: b.cancelReason })}</div> : null}
                {b.payment.status === 'REFUNDED' ? <div>{t('bookingDetail.refundedNote', { amount: formatVnd(b.payment.amountVnd) })}</div> : null}
                {b.payment.refundFailed ? <div>{t('bookingDetail.refundFailed')}</div> : null}
              </>
            }
          />
        ) : null}
        {b.status === 'EXPIRED' ? (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            message={t('bookingDetail.expiredNote')}
            description={b.payment.status === 'REFUNDED' ? t('bookingDetail.refundedNote', { amount: formatVnd(b.payment.amountVnd) }) : undefined}
            action={<Link to={b.slotId ? ROUTES.book(b.slotId) : ROUTES.tutor(b.tutor.id)}><Button>{t('bookingDetail.rebook')}</Button></Link>}
          />
        ) : null}

        <div style={{ marginTop: 16 }}>
          <Typography.Title level={5}>{t('bookingDetail.actions')}</Typography.Title>
          <Actions booking={b} hours={config?.cancellationWindowHours} />
        </div>

        {b.review ? (
          <div style={{ marginTop: 16 }}>
            <Typography.Title level={5}>{t('bookingDetail.yourReview')}</Typography.Title>
            <Rate disabled value={b.review.rating} />
            {b.review.comment ? <div style={{ whiteSpace: 'pre-wrap' }}>{b.review.comment}</div> : null}
          </div>
        ) : null}

        {events.length > 0 ? (
          <div style={{ marginTop: 16 }}>
            <Typography.Title level={5}>{t('bookingDetail.history')}</Typography.Title>
            <List size="small" dataSource={events} renderItem={(e) => <List.Item>{e}</List.Item>} />
          </div>
        ) : null}
      </Card>
    </>
  );
}
