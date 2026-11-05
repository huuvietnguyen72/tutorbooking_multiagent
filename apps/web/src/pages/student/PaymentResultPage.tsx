import { Button, Result, Skeleton, Space, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMe, useStudentBooking } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { RESULT_POLL_MAX_MS, RESULT_POLL_MS } from '../../lib/polling';
import { formatSession } from '../../lib/time';
import { isNotFound } from './bookingCommon';

/**
 * S-09: never trusts the URL or query string. It reads the booking from the API and, while the webhook has not
 * landed yet (PENDING_PAYMENT), polls every 2 s for at most 30 s without guessing an outcome.
 */
export default function PaymentResultPage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const { data: me } = useMe();
  const [timedOut, setTimedOut] = useState(false);
  const [polling, setPolling] = useState(true);
  const query = useStudentBooking(bookingId, { refetchInterval: polling ? RESULT_POLL_MS : false });
  const booking = query.data;
  const pending = booking?.status === 'PENDING_PAYMENT';

  useEffect(() => {
    if (!pending) {
      setPolling(false);
      return undefined;
    }
    setPolling(true);
    const id = setTimeout(() => {
      setPolling(false);
      setTimedOut(true);
    }, RESULT_POLL_MAX_MS);
    return () => clearTimeout(id);
  }, [pending]);

  const myBookings = <Link key="mine" to={ROUTES.myBookings}><Button type="primary">{t('payResult.viewBookings')}</Button></Link>;
  if (query.isPending) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (query.isError) {
    if (isNotFound(query.error)) return <StatusPage status="404" extra={myBookings} />;
    return <ErrorState message={t('payResult.loadError')} onRetry={() => void query.refetch()} />;
  }

  const b = query.data;
  const time = formatSession(b.startAt, b.endAt);
  const toTutors = <Link key="tutors" to={ROUTES.tutors}><Button>{t('payResult.toTutors')}</Button></Link>;

  if (b.status === 'PENDING_PAYMENT') {
    if (timedOut) {
      return <Result status="warning" title={t('payResult.timeout')} extra={[myBookings]} />;
    }
    return (
      <Result
        icon={<Spin size="large" />}
        title={t('payResult.checking')}
        extra={<Link to={ROUTES.pay(b.id)}><Button>{t('payment.title')}</Button></Link>}
      />
    );
  }

  if (b.status === 'CONFIRMED') {
    return (
      <Result
        status="success"
        title={t('payResult.successTitle')}
        subTitle={
          <>
            <div>{b.code} · {b.tutor.fullName}</div>
            <div>{time} ({t('app.timezoneNote')})</div>
            {me ? <div>{t('payResult.successEmail', { email: me.email })}</div> : null}
          </>
        }
        extra={[myBookings, <Link key="more" to={ROUTES.tutors}><Button>{t('payResult.findMore')}</Button></Link>]}
      />
    );
  }

  const rebookTarget = b.slotId ? ROUTES.book(b.slotId) : ROUTES.tutor(b.tutor.id);
  // Declined at the gateway is the only "failed" outcome; hold expiry (with or without a late payment) is "expired".
  if (b.status === 'EXPIRED' && b.payment.failureReason === 'DECLINED') {
    return (
      <Result
        status="error"
        title={t('payResult.failTitle')}
        subTitle={t('payResult.failBody')}
        extra={[<Link key="again" to={rebookTarget}><Button type="primary">{t('payResult.rebook')}</Button></Link>, toTutors]}
      />
    );
  }
  if (b.status === 'EXPIRED') {
    return (
      <Result
        status="warning"
        title={t('payResult.expiredTitle')}
        subTitle={
          <Space direction="vertical" size={0}>
            <span>{t('payResult.expiredBody', { time })}</span>
            {b.payment.status === 'REFUNDED' ? <strong>{t('payResult.autoRefunded')}</strong> : null}
          </Space>
        }
        extra={[<Link key="pick" to={ROUTES.tutor(b.tutor.id)}><Button type="primary">{t('payResult.rePick')}</Button></Link>, toTutors]}
      />
    );
  }
  return <Result status="info" title={t('payResult.cancelledTitle')} extra={[myBookings, toTutors]} />;
}
