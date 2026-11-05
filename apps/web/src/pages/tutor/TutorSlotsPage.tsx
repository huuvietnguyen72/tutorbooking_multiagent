import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../auth/routes';
import { errorText } from '../../api/errors';
import {
  useCreateSlots,
  useDeleteSlot,
  useMoveSlot,
  useMySlots,
  usePublicConfig,
  useReopenSlot,
} from '../../api/hooks';
import type { SlotStatus, TutorSlot } from '../../api/types';
import { CardSkeletons, EmptyState, ErrorState } from '../../components/States';
import {
  addDaysIso,
  dayKey,
  formatShortDay,
  formatTimeRange,
  formatWeekLabel,
  formatWeekdayDate,
  startOfWeekIso,
  timeKey,
  todayKey,
  toUtcIso,
  weekDays,
} from '../../lib/time';

const STATUS_COLOR: Record<SlotStatus, string> = {
  AVAILABLE: 'green',
  HELD: 'gold',
  BOOKED: 'blue',
  CLOSED: 'default',
};

interface EditorState {
  /** `null` = creating a new slot */
  slot: TutorSlot | null;
}

function SlotEditor({ slot, onClose }: { slot: TutorSlot | null; onClose: () => void }) {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const create = useCreateSlots();
  const move = useMoveSlot();
  const [date, setDate] = useState(slot ? dayKey(slot.startAt) : '');
  const [time, setTime] = useState(slot ? timeKey(slot.startAt) : '');
  const [dateError, setDateError] = useState<string>();
  const [timeError, setTimeError] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || move.isPending;

  const submit = () => {
    setError(null);
    const dErr = date ? undefined : t('validation.dateRequired');
    const tErr = time ? undefined : t('validation.timeRequired');
    setDateError(dErr);
    setTimeError(tErr);
    if (dErr || tErr) return;
    const startAt = toUtcIso(date, time);
    if (new Date(startAt).getTime() <= Date.now()) {
      setDateError(t('validation.slotInPast'));
      return;
    }
    const done = (key: string) => () => {
      void message.success(t(key));
      onClose();
    };
    if (slot) move.mutate({ slotId: slot.id, startAt }, { onSuccess: done('tutorSlots.moved'), onError: (e) => setError(errorText(e)) });
    else create.mutate([startAt], { onSuccess: done('tutorSlots.added'), onError: (e) => setError(errorText(e)) });
  };

  return (
    <Modal
      open
      title={slot ? t('tutorSlots.editTitle') : t('tutorSlots.addTitle')}
      onCancel={onClose}
      onOk={submit}
      okText={slot ? t('tutorSlots.submitEdit') : t('tutorSlots.submitAdd')}
      cancelText={t('tutorSlots.cancel')}
      confirmLoading={pending}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
      <Form layout="vertical" noValidate onFinish={submit}>
        <Form.Item label={t('tutorSlots.date')} htmlFor="slot-date" validateStatus={dateError ? 'error' : undefined} help={dateError}>
          <Input id="slot-date" type="date" min={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Form.Item>
        <Form.Item label={t('tutorSlots.startTime')} htmlFor="slot-time" validateStatus={timeError ? 'error' : undefined} help={timeError}>
          <Input id="slot-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Form.Item>
        <Form.Item label={t('tutorSlots.duration')}>
          <Typography.Text>{t('tutorSlots.durationValue', { minutes: config.data?.slotDurationMinutes ?? 60 })}</Typography.Text>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** S-18 / S-19: weekly slot management for approved tutors. */
export default function TutorSlotsPage() {
  const { t } = useTranslation();
  const currentWeek = useMemo(() => startOfWeekIso(), []);
  const [weekStart, setWeekStart] = useState(currentWeek);
  const slots = useMySlots(weekStart, addDaysIso(weekStart, 7));
  const reopen = useReopenSlot();
  const remove = useDeleteSlot();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<TutorSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byDay = new Map<string, TutorSlot[]>();
  for (const slot of slots.data ?? []) {
    const key = dayKey(slot.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), slot].sort((a, b) => a.startAt.localeCompare(b.startAt)));
  }

  const onReopen = (slot: TutorSlot) => {
    setError(null);
    reopen.mutate(slot.id, {
      onSuccess: () => void message.success(t('tutorSlots.reopened')),
      onError: (e) => setError(errorText(e)),
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    setError(null);
    remove.mutate(deleting.id, {
      onSuccess: () => void message.success(t('tutorSlots.deleted')),
      onError: (e) => setError(errorText(e)),
      onSettled: () => setDeleting(null),
    });
  };

  const addButton = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ slot: null })}>
      {t('tutorSlots.add')}
    </Button>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t('tutorSlots.title')} <Typography.Text type="secondary">({t('app.timezoneNote')})</Typography.Text>
        </Typography.Title>
        <Space wrap>
          <Button icon={<LeftOutlined />} onClick={() => setWeekStart((w) => addDaysIso(w, -7))} aria-label={t('tutorDetail.prevWeek')} />
          <span>{t('tutorDetail.weekLabel', { range: formatWeekLabel(weekStart) })}</span>
          <Button icon={<RightOutlined />} onClick={() => setWeekStart((w) => addDaysIso(w, 7))} aria-label={t('tutorDetail.nextWeek')} />
          {addButton}
        </Space>
      </div>

      <Alert type="info" showIcon style={{ marginTop: 16 }} message={t('tutorSlots.lockedNote')} />
      {error ? <Alert type="error" showIcon role="alert" closable onClose={() => setError(null)} message={error} style={{ marginTop: 16 }} /> : null}

      <div style={{ marginTop: 16 }}>
        {slots.isPending ? (
          <CardSkeletons count={2} />
        ) : slots.isError ? (
          <ErrorState message={t('tutorSlots.loadError')} onRetry={() => void slots.refetch()} />
        ) : slots.data.length === 0 && weekStart === currentWeek ? (
          <EmptyState title={t('tutorSlots.empty')} hint={t('tutorSlots.emptyHint')} action={addButton} />
        ) : (
          weekDays(weekStart).map((day) => {
            const list = byDay.get(dayKey(day)) ?? [];
            return (
              <div key={day} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
                <strong style={{ width: 90 }}>{formatShortDay(day)}</strong>
                <Space wrap>
                  {list.length === 0 ? (
                    <Typography.Text type="secondary">{t('tutorSlots.noSlotsDay')}</Typography.Text>
                  ) : (
                    list.map((slot) => (
                      <Card
                        key={slot.id}
                        size="small"
                        aria-label={`${formatWeekdayDate(slot.startAt)} ${formatTimeRange(slot.startAt, slot.endAt)}`}
                      >
                        <Space direction="vertical" size={4}>
                          <strong>{formatTimeRange(slot.startAt, slot.endAt)}</strong>
                          <Tag color={STATUS_COLOR[slot.status]}>
                            {slot.status === 'BOOKED' && slot.booking?.studentName
                              ? t('tutorSlots.bookedBy', { name: slot.booking.studentName })
                              : t(`tutorSlots.status.${slot.status}`)}
                          </Tag>
                          <Space size={4} wrap>
                            {slot.status === 'AVAILABLE' ? (
                              <>
                                <Button size="small" onClick={() => setEditor({ slot })}>{t('tutorSlots.edit')}</Button>
                                <Button size="small" danger onClick={() => setDeleting(slot)}>{t('tutorSlots.delete')}</Button>
                              </>
                            ) : null}
                            {slot.status === 'CLOSED' ? (
                              <>
                                <Button size="small" onClick={() => onReopen(slot)} loading={reopen.isPending && reopen.variables === slot.id}>
                                  {t('tutorSlots.reopen')}
                                </Button>
                                <Button size="small" danger onClick={() => setDeleting(slot)}>{t('tutorSlots.delete')}</Button>
                              </>
                            ) : null}
                            {slot.status === 'BOOKED' && slot.booking?.id ? (
                              <Link to={ROUTES.tutorSession(slot.booking.id)}>{t('tutorSlots.viewSession')}</Link>
                            ) : null}
                          </Space>
                        </Space>
                      </Card>
                    ))
                  )}
                </Space>
              </div>
            );
          })
        )}
      </div>

      {editor ? <SlotEditor slot={editor.slot} onClose={() => setEditor(null)} /> : null}
      <Modal
        open={!!deleting}
        title={t('tutorSlots.deleteTitle')}
        onCancel={() => setDeleting(null)}
        onOk={confirmDelete}
        okText={t('tutorSlots.deleteConfirm')}
        okButtonProps={{ danger: true }}
        cancelText={t('tutorSlots.deleteKeep')}
        confirmLoading={remove.isPending}
      >
        {deleting ? t('tutorSlots.deleteBody', { time: `${formatWeekdayDate(deleting.startAt)} ${formatTimeRange(deleting.startAt, deleting.endAt)}` }) : null}
      </Modal>
    </Card>
  );
}
