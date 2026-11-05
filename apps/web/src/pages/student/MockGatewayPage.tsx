import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Skeleton, Space, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useCompleteGatewayPayment, useGatewayPayment } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { safeNext } from '../../lib/safeNext';
import { isNotFound } from './bookingCommon';

/** Deliberately outside AppLayout and styled differently from the shop, like a real hosted payment page. */
function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <main style={{ minHeight: '100vh', background: '#1f2a44', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 8, width: '100%', maxWidth: 440, overflow: 'hidden' }}>
        <div style={{ background: '#0b5cff', color: '#fff', padding: '12px 24px' }}>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>{t('gateway.title')}</Typography.Title>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </main>
  );
}

/** S-08: the shopper picks the outcome; the API signs and delivers the webhook itself. */
export default function MockGatewayPage() {
  const { t } = useTranslation();
  const { paymentId = '' } = useParams();
  const navigate = useNavigate();
  const query = useGatewayPayment(paymentId);
  const complete = useCompleteGatewayPayment(paymentId);

  if (query.isPending) return <Shell><Skeleton active paragraph={{ rows: 3 }} /></Shell>;
  if (query.isError) {
    if (isNotFound(query.error)) return <StatusPage status="404" extra={<Link to={ROUTES.home}><Button type="primary">{t('gateway.back')}</Button></Link>} />;
    return <Shell><ErrorState message={t('gateway.loadError')} onRetry={() => void query.refetch()} /></Shell>;
  }

  const payment = query.data;
  const resultPage = ROUTES.payResult(payment.bookingId);
  const choose = (result: 'SUCCESS' | 'FAILURE') =>
    complete.mutate(result, {
      onSuccess: (res) => navigate(safeNext(res.redirectUrl) ?? resultPage, { replace: true }),
      onError: (err) => {
        // Already completed elsewhere: nothing more to do here, the result page shows the real state.
        if (err instanceof ApiError && err.code === 'GATEWAY_ALREADY_COMPLETED') void query.refetch();
      },
    });

  if (complete.isPending || complete.isSuccess) {
    return <Shell><div role="status" style={{ textAlign: 'center' }}><Spin /><p>{t('gateway.processing')}</p></div></Shell>;
  }

  return (
    <Shell>
      <p>
        {t('gateway.order', { code: payment.bookingCode })}
        <br />
        {t('gateway.amount')}: <strong>{formatVnd(payment.amountVnd)}</strong>
      </p>
      {payment.holdExpired && payment.completable ? <Alert type="warning" showIcon message={t('gateway.lateNote')} style={{ marginBottom: 12 }} /> : null}
      {!payment.completable ? <Alert type="info" showIcon message={t('gateway.done')} style={{ marginBottom: 12 }} /> : null}
      {complete.isError ? <Alert type="error" showIcon role="alert" message={errorText(complete.error)} style={{ marginBottom: 12 }} /> : null}
      {payment.completable ? (
        <>
          <p>{t('gateway.choose')}</p>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Button block type="primary" icon={<CheckCircleOutlined />} onClick={() => choose('SUCCESS')}>{t('gateway.success')}</Button>
            <Button block danger icon={<CloseCircleOutlined />} onClick={() => choose('FAILURE')}>{t('gateway.failure')}</Button>
          </Space>
        </>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Link to={payment.completable ? ROUTES.pay(payment.bookingId) : resultPage}><Button block>{t('gateway.back')}</Button></Link>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>ⓘ {t('gateway.testOnly')}</Typography.Paragraph>
    </Shell>
  );
}
