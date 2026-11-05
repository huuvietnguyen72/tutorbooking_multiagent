import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Skeleton, Tooltip, Typography, message } from 'antd';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useMyTeachingBooking, useTutorCancelBooking } from '../../api/hooks';
import type { TutorBooking } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import { ErrorState, StatusPage } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatDate, formatDateTime, formatTimeRange } from '../../lib/time';
import { BookingStatusTag } from './TutorSessionsPage';

const schema = z.object({
  reason: z.string().trim().min(1, 'validation.reasonRequired').max(500, 'validation.reasonMax'),
});
type Values = z.infer<typeof schema>;

/** S-22: reason is mandatory; the student gets a 100% refund and the slot closes. */
function CancelModal({ booking, onClose }: { booking: TutorBooking; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useTutorCancelBooking(booking.id);
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  const submit = handleSubmit((values) => {
    setError(null);
    cancel.mutate(values.reason, {
      onSuccess: () => {
        void message.success(t('tutorSessions.cancelled_ok'));
        onClose();
      },
      onError: (err) => {
        setError(errorText(err));
        // The session may have started or been cancelled meanwhile; the refetched `actions` will reflect it.
        if (err instanceof ApiError && (err.code === 'SESSION_STARTED' || err.code === 'NOT_CONFIRMED')) onClose();
      },
    });
  });

  return (
    <Modal
      open
      title={t('tutorSessions.modalTitle', { name: booking.student.fullName })}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('tutorSessions.confirm')}
      okButtonProps={{ danger: true }}
      cancelText={t('tutorSessions.keep')}
      confirmLoading={cancel.isPending}
      destroyOnHidden
    >
      <Alert type="warning" showIcon message={t('tutorSessions.warning')} style={{ marginBottom: 16 }} />
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <Form.Item
            label={`${t('tutorSessions.reason')} *`}
            htmlFor="cancel-reason"
            validateStatus={fieldState.error ? 'error' : undefined}
            help={fieldState.error ? t(fieldState.error.message as string) : undefined}
          >
            <Input.TextArea {...field} id="cancel-reason" rows={3} maxLength={500} />
          </Form.Item>
        )}
      />
    </Modal>
  );
}

/** S-21: session detail with the cancel action. */
export default function TutorSessionDetailPage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const query = useMyTeachingBooking(bookingId);
  const [cancelling, setCancelling] = useState(false);

  const back = <Link to={ROUTES.tutorSessions}>‹ {t('tutorSessions.back')}</Link>;
  if (query.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <StatusPage status="404" extra={<Link to={ROUTES.tutorSessions}><Button type="primary">{t('tutorSessions.back')}</Button></Link>} />;
    }
    return <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />;
  }

  const b = query.data;
  const { allowed, reasonCode } = b.actions.cancel;
  const disabledReason =
    reasonCode === 'SESSION_STARTED'
      ? t('tutorSessions.cancelStarted')
      : reasonCode === 'NOT_CONFIRMED'
        ? t('tutorSessions.cancelNotConfirmed')
        : undefined;

  return (
    <>
      {back}
      <Card style={{ marginTop: 12 }}>
        <Typography.Title level={3}>{t('tutorSessions.title')} <BookingStatusTag booking={b} /></Typography.Title>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label={t('tutorSessions.student')}>{b.student.fullName}</Descriptions.Item>
          <Descriptions.Item label={t('tutorSessions.time')}>{formatDate(b.startAt)} {formatTimeRange(b.startAt, b.endAt)}</Descriptions.Item>
          <Descriptions.Item label={t('tutorSessions.fee')}>{formatVnd(b.priceVnd)}</Descriptions.Item>
          <Descriptions.Item label={t('tutorSessions.code')}>{b.code}</Descriptions.Item>
          {b.cancelledAt ? (
            <Descriptions.Item label={t('tutorSessions.status')}>
              {t('tutorSessions.cancelledAt', { time: formatDateTime(b.cancelledAt) })}
              {b.tutorCancelReason ? <div>{t('tutorSessions.yourReason', { reason: b.tutorCancelReason })}</div> : null}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
        {b.status === 'CONFIRMED' ? (
          <div style={{ marginTop: 16 }}>
            <Tooltip title={!allowed ? disabledReason : undefined}>
              {/* wrapper keeps the tooltip working on a disabled button */}
              <span>
                <Button danger disabled={!allowed} onClick={() => setCancelling(true)}>
                  {t('tutorSessions.cancel')}
                </Button>
              </span>
            </Tooltip>
            {!allowed && disabledReason ? (
              <div><Typography.Text type="secondary">{disabledReason}</Typography.Text></div>
            ) : null}
          </div>
        ) : null}
      </Card>
      {cancelling ? <CancelModal booking={b} onClose={() => setCancelling(false)} /> : null}
    </>
  );
}
