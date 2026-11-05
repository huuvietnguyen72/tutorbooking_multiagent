import { Alert, Button, Card, Descriptions, Modal, Skeleton, Space, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { errorText } from '../../api/errors';
import { useStudentBooking, useStudentCancel } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatCountdown, formatSession } from '../../lib/time';
import { useCountdown } from '../../lib/useCountdown';
import { isNotFound } from './bookingCommon';
import { useResumeCheckoutRedirect } from './useResumeCheckoutRedirect';

const LOW_TIME_MS = 60_000;
/** Once the local countdown reaches 0 but the server still says PENDING_PAYMENT (clock skew), re-ask until it decides. */
const SETTLE_POLL_MS = 2000;

/** S-07: hold countdown (driven by `serverTime`), pay now / release the slot. */
export default function PaymentPage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const navigate = useNavigate();
  const [settling, setSettling] = useState(false);
  const query = useStudentBooking(bookingId, { refetchInterval: settling ? SETTLE_POLL_MS : false });
  const booking = query.data;
  const remaining = useCountdown(booking?.status === 'PENDING_PAYMENT' ? booking.holdExpiresAt : null, booking?.serverTime);
  const resume = useResumeCheckoutRedirect(bookingId);
  const cancel = useStudentCancel(bookingId);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    setSettling(remaining === 0);
  }, [remaining]);

  if (query.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (query.isError) {
    if (isNotFound(query.error)) {
      return <StatusPage status="404" extra={<Link to={ROUTES.myBookings}><Button type="primary">{t('bookingDetail.back')}</Button></Link>} />;
    }
    return <ErrorState message={t('payment.loadError')} onRetry={() => void query.refetch()} />;
  }
  // Anything but a live hold (paid, expired, cancelled) is shown by the result page, which reads the real state.
  const current = query.data;
  if (current.status !== 'PENDING_PAYMENT') return <Navigate to={ROUTES.payResult(bookingId)} replace />;

  const release = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        void message.success(t('payment.cancelled'));
        navigate(ROUTES.myBookings, { replace: true });
      },
      onError: (err) => {
        void message.error(errorText(err));
        setConfirmCancel(false);
      },
    });

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      <Typography.Title level={3}>
        {t('payment.title')} · {t('payment.code', { code: current.code })}
      </Typography.Title>
      {remaining !== null && remaining > 0 && remaining < LOW_TIME_MS ? (
        <Alert type="warning" showIcon message={t('payment.lowTime')} style={{ marginBottom: 12 }} />
      ) : null}
      <Alert
        type="info"
        message={
          <span>
            ⏱ {t('payment.holdLeft')}{' '}
            <strong role="timer" aria-live="off" data-testid="hold-countdown">{formatCountdown(remaining ?? 0)}</strong>
          </span>
        }
        style={{ marginBottom: 16 }}
      />
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={current.tutor.fullName}>
          {formatSession(current.startAt, current.endAt)} ({t('app.timezoneNote')})
        </Descriptions.Item>
        <Descriptions.Item label={t('payment.total')}>{formatVnd(current.priceVnd)}</Descriptions.Item>
        <Descriptions.Item label={t('payment.method')}>{t('payment.methodMock')}</Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>ⓘ {t('payment.testNote')}</Typography.Paragraph>
      <Space style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={() => setConfirmCancel(true)}>{t('payment.cancel')}</Button>
        <Button type="primary" loading={resume.isPending} onClick={() => resume.run()}>{t('payment.payNow')}</Button>
      </Space>
      <Modal
        open={confirmCancel}
        title={t('payment.cancelTitle')}
        onCancel={() => setConfirmCancel(false)}
        onOk={release}
        okText={t('payment.cancelConfirm')}
        okButtonProps={{ danger: true }}
        cancelText={t('payment.cancelKeep')}
        confirmLoading={cancel.isPending}
      >
        {t('payment.cancelBody')}
      </Modal>
    </Card>
  );
}
