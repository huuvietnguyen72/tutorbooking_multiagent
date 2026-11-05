import { Alert, Button, Card, Descriptions, Skeleton, Space, Typography } from 'antd';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useCreateBooking, usePublicConfig, useSlot } from '../../api/hooks';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatDateTime, formatSession, formatTimeRange } from '../../lib/time';

interface Conflict {
  startAt?: string;
  endAt?: string;
}

/** S-06: confirm the slot, create the PENDING_PAYMENT booking, continue to S-07. */
export default function BookingConfirmPage() {
  const { t } = useTranslation();
  const { slotId = '' } = useParams();
  const navigate = useNavigate();
  const slot = useSlot(slotId);
  const { data: config } = usePublicConfig();
  const create = useCreateBooking();
  // One key per page visit: a double click or a retry after a lost response returns the same booking.
  const idempotencyKey = useRef(globalThis.crypto?.randomUUID?.());

  const toTutors = <Link to={ROUTES.tutors}><Button type="primary">{t('booking.chooseOther')}</Button></Link>;
  if (slot.isPending) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (slot.isError) {
    if (slot.error instanceof ApiError && slot.error.status === 404) {
      return <StatusPage status="404" extra={toTutors} />;
    }
    return <ErrorState message={t('booking.loadError')} onRetry={() => void slot.refetch()} />;
  }

  const { tutor, priceVnd } = slot.data;
  const tutorPage = ROUTES.tutor(tutor.id);

  const confirm = () =>
    create.mutate(
      { slotId, idempotencyKey: idempotencyKey.current },
      { onSuccess: (res) => navigate(ROUTES.pay(res.booking.id), { replace: true }) },
    );

  let errorMessage: string | null = null;
  if (create.isError) {
    const err = create.error;
    const conflict = err instanceof ApiError && err.code === 'STUDENT_OVERLAP'
      ? ((err.details?.conflictingBooking as Conflict | undefined) ?? undefined)
      : undefined;
    errorMessage = conflict?.startAt && conflict.endAt
      ? t('booking.overlap', { time: `${formatDateTime(conflict.startAt).slice(0, 5)} ${formatTimeRange(conflict.startAt, conflict.endAt)}` })
      : errorText(err);
  }
  const slotGone = create.isError && create.error instanceof ApiError && create.error.status === 409;

  return (
    <Card style={{ maxWidth: 640, margin: '0 auto' }}>
      <Typography.Title level={3}>{t('booking.title')}</Typography.Title>
      {errorMessage ? (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={errorMessage}
          style={{ marginBottom: 16 }}
          action={slotGone ? <Link to={tutorPage}><Button>{t('booking.chooseOther')}</Button></Link> : undefined}
        />
      ) : null}
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={t('booking.tutor')}>
          {tutor.fullName} ({tutor.subjects.map((s) => s.name).join(', ')})
        </Descriptions.Item>
        <Descriptions.Item label={t('booking.time')}>
          {formatSession(slot.data.startAt, slot.data.endAt)} <Typography.Text type="secondary">({t('app.timezoneNote')})</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('booking.fee')}>{formatVnd(priceVnd)}</Descriptions.Item>
      </Descriptions>
      {config ? (
        <Space direction="vertical" style={{ marginTop: 16 }}>
          <Typography.Text>ⓘ {t('booking.holdNote', { minutes: config.holdMinutes })}</Typography.Text>
          <Typography.Text>ⓘ {t('booking.policyNote', { hours: config.cancellationWindowHours })}</Typography.Text>
        </Space>
      ) : null}
      <Space style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Link to={tutorPage}><Button>{t('booking.back')}</Button></Link>
        <Button type="primary" loading={create.isPending} disabled={slotGone} onClick={confirm}>
          {t('booking.confirm')}
        </Button>
      </Space>
    </Card>
  );
}
