import { Alert, Button, Card, Modal, Skeleton, Space, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useReschedule, useStudentBooking, useTutorSlots } from '../../api/hooks';
import type { PublicSlot } from '../../api/types';
import { ROUTES } from '../../auth/routes';
import SlotCalendar from '../../components/SlotCalendar';
import { ErrorState, StatusPage } from '../../components/States';
import { addDaysIso, formatSession, startOfWeekIso } from '../../lib/time';
import { isNotFound } from './bookingCommon';

/** S-13: pick a new slot of the same tutor. The old booking stays untouched unless the atomic swap succeeds. */
export default function ReschedulePage() {
  const { t } = useTranslation();
  const { bookingId = '' } = useParams();
  const navigate = useNavigate();
  const query = useStudentBooking(bookingId);
  const booking = query.data;
  const tutorId = booking?.tutor.id ?? '';

  const currentWeek = useMemo(() => startOfWeekIso(), []);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const slots = useTutorSlots(tutorId, weekStart, addDaysIso(weekStart, 7));
  const [selected, setSelected] = useState<PublicSlot | null>(null);
  const [confirming, setConfirming] = useState(false);
  const reschedule = useReschedule(bookingId);
  const [error, setError] = useState<{ text: string; kept: boolean } | null>(null);

  const back = <Link to={ROUTES.booking(bookingId)}>‹ {t('app.back')}</Link>;
  if (query.isPending) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (query.isError) {
    if (isNotFound(query.error)) return <StatusPage status="404" extra={<Link to={ROUTES.myBookings}><Button type="primary">{t('bookingDetail.back')}</Button></Link>} />;
    return <ErrorState message={t('reschedule.loadError')} onRetry={() => void query.refetch()} />;
  }

  const b = query.data;
  if (!b.actions?.reschedule.allowed) {
    const code = b.actions?.reschedule.reasonCode;
    return (
      <>
        {back}
        <Alert style={{ marginTop: 12 }} type="warning" showIcon message={t('reschedule.notAllowed')} description={code ? t(`bookingDetail.disabled.${code}`, { hours: '' }) : undefined} />
      </>
    );
  }

  const submit = () => {
    if (!selected) return;
    setError(null);
    reschedule.mutate(selected.id, {
      onSuccess: () => {
        void message.success(t('reschedule.ok'));
        navigate(ROUTES.booking(bookingId), { replace: true });
      },
      onError: (err) => {
        const code = err instanceof ApiError ? err.code : undefined;
        setError({ text: code === 'STUDENT_OVERLAP' ? t('reschedule.overlapNew') : errorText(err), kept: code === 'SLOT_UNAVAILABLE' || code === 'SLOT_TOO_SOON' || code === 'STUDENT_OVERLAP' });
        setSelected(null);
        // The window closed or the state changed: the detail page shows what is still possible.
        if (code === 'WINDOW_PASSED' || code === 'RESCHEDULE_LIMIT' || code === 'NOT_CONFIRMED') {
          void message.error(errorText(err));
          navigate(ROUTES.booking(bookingId), { replace: true });
        }
      },
      onSettled: () => setConfirming(false),
    });
  };

  return (
    <>
      {back}
      <Card style={{ marginTop: 12 }}>
        <Typography.Title level={3}>{t('reschedule.title', { name: b.tutor.fullName })}</Typography.Title>
        <p>{t('reschedule.current')}: <strong>{formatSession(b.startAt, b.endAt)}</strong> ({t('app.timezoneNote')})</p>
        {error ? (
          <Alert type="error" showIcon role="alert" style={{ marginBottom: 16 }} message={error.text} description={error.kept ? t('reschedule.keptOld') : undefined} />
        ) : null}
        <SlotCalendar
          weekStart={weekStart}
          canGoPrev={weekStart > currentWeek}
          onPrev={() => setWeekStart((w) => addDaysIso(w, -7))}
          onNext={() => setWeekStart((w) => addDaysIso(w, 7))}
          slots={slots.data}
          isPending={slots.isPending}
          isError={slots.isError}
          onRetry={() => void slots.refetch()}
          onSelect={(slot) => setSelected(slot)}
          highlightSlotId={selected?.id}
        />
        <Typography.Paragraph style={{ marginTop: 16 }}>
          {selected ? <strong>{t('reschedule.selected', { time: formatSession(selected.startAt, selected.endAt) })}</strong> : t('reschedule.pick')}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">ⓘ {t('reschedule.free')}</Typography.Paragraph>
        <Space>
          <Link to={ROUTES.booking(bookingId)}><Button>{t('reschedule.abort')}</Button></Link>
          <Button type="primary" disabled={!selected} onClick={() => setConfirming(true)}>{t('reschedule.confirm')}</Button>
        </Space>
      </Card>
      <Modal
        open={confirming}
        title={t('reschedule.confirm')}
        onCancel={() => setConfirming(false)}
        onOk={submit}
        okText={t('reschedule.finalOk')}
        cancelText={t('reschedule.finalCancel')}
        confirmLoading={reschedule.isPending}
      >
        {t('reschedule.finalConfirm')}
      </Modal>
    </>
  );
}
