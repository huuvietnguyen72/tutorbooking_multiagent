import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { PublicSlot } from '../api/types';
import { dayKey, formatShortDay, formatTimeRange, formatWeekLabel, formatWeekdayDate, weekDays } from '../lib/time';
import { CardSkeletons, ErrorState } from './States';

interface Props {
  weekStart: string;
  canGoPrev: boolean;
  onPrev: () => void;
  onNext: () => void;
  slots: PublicSlot[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** `null` = slots are not clickable for the current viewer (tutor/admin). */
  onSelect: ((slot: PublicSlot) => void) | null;
  highlightSlotId?: string | null;
}

/** Week grid of public slots (S-03, reusable for S-13). */
export default function SlotCalendar({
  weekStart,
  canGoPrev,
  onPrev,
  onNext,
  slots,
  isPending,
  isError,
  onRetry,
  onSelect,
  highlightSlotId,
}: Props) {
  const { t } = useTranslation();
  const days = weekDays(weekStart);
  const byDay = new Map<string, PublicSlot[]>();
  for (const slot of slots ?? []) {
    const key = dayKey(slot.startAt);
    byDay.set(key, [...(byDay.get(key) ?? []), slot].sort((a, b) => a.startAt.localeCompare(b.startAt)));
  }
  const empty = !!slots && slots.length === 0;

  return (
    <section aria-label={t('tutorDetail.slots')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('tutorDetail.slots')} <Typography.Text type="secondary">({t('app.timezoneNote')})</Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<LeftOutlined />} onClick={onPrev} disabled={!canGoPrev} aria-label={t('tutorDetail.prevWeek')} />
          <span>{t('tutorDetail.weekLabel', { range: formatWeekLabel(weekStart) })}</span>
          <Button icon={<RightOutlined />} onClick={onNext} aria-label={t('tutorDetail.nextWeek')} />
        </Space>
      </div>
      <div style={{ marginTop: 16 }}>
        {isPending ? (
          <CardSkeletons count={2} />
        ) : isError ? (
          <ErrorState message={t('tutorDetail.slotsError')} onRetry={onRetry} />
        ) : empty ? (
          <div role="status">
            <p>{t('tutorDetail.noSlotsWeek')}</p>
            <Button onClick={onNext}>{t('tutorDetail.seeNextWeek')}</Button>
          </div>
        ) : (
          <>
            {days.map((day) => {
              const list = byDay.get(dayKey(day)) ?? [];
              return (
                <div key={day} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
                  <strong style={{ width: 90 }}>{formatShortDay(day)}</strong>
                  <Space wrap>
                    {list.length === 0 ? (
                      <Typography.Text type="secondary">{t('tutorDetail.noSlotsDay')}</Typography.Text>
                    ) : (
                      list.map((slot) => {
                        const available = slot.status === 'AVAILABLE';
                        const label = formatTimeRange(slot.startAt, slot.endAt);
                        return (
                          <Button
                            key={slot.id}
                            type={highlightSlotId === slot.id ? 'primary' : 'default'}
                            ghost={highlightSlotId === slot.id}
                            disabled={!available || !onSelect}
                            onClick={() => onSelect?.(slot)}
                            aria-label={`${formatWeekdayDate(slot.startAt)} ${label}${available ? '' : `, ${t('tutorDetail.slotUnavailable')}`}`}
                          >
                            {label}
                          </Button>
                        );
                      })
                    )}
                  </Space>
                </div>
              );
            })}
            <p style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">
                {t('tutorDetail.legendAvailable')} · {t('tutorDetail.legendUnavailable')}
              </Typography.Text>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
