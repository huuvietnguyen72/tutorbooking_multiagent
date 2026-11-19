import { Card, Collapse, Descriptions, List, Radio, Select, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMyEarningItems, useMyEarnings } from '../../api/hooks';
import type { EarningSettlementFilter, EarningSort, TutorEarningItem, TutorEarningsSummary } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { formatDate, formatDateTime, formatMonth, formatTimeRange, monthKey } from '../../lib/time';

const MAX_MONTHS = 24;
const PAGE_SIZE = 10;
const MONTH_OPTIONS = Array.from({ length: MAX_MONTHS }, (_, i) => {
  const value = monthKey(i);
  return { value, label: formatMonth(value) };
});

function percent(rate: number): string {
  return String(Math.round(rate * 1000) / 10).replace('.', ',');
}

function SummarySection({ month }: { month: string }) {
  const { t } = useTranslation();
  const query = useMyEarnings(month);

  if (query.isPending) return <Skeleton active aria-busy="true" paragraph={{ rows: 4 }} />;
  if (query.isError) return <ErrorState message={t('tutorEarnings.loadError')} onRetry={() => void query.refetch()} />;
  const s: TutorEarningsSummary = query.data;

  const stats: { key: string; label: string; value: string }[] = [
    { key: 'sessions', label: t('tutorEarnings.stats.sessions'), value: String(s.sessionCount) },
    { key: 'gross', label: t('tutorEarnings.stats.gross'), value: formatVnd(s.grossVnd) },
    { key: 'fee', label: t('tutorEarnings.stats.fee'), value: formatVnd(s.platformFeeVnd) },
    { key: 'net', label: t('tutorEarnings.stats.net'), value: formatVnd(s.netVnd) },
  ];

  return (
    <div>
      {s.isEmpty ? <EmptyState title={t('tutorEarnings.empty')} hint={t('tutorEarnings.emptyHint')} /> : null}
      <ul aria-label={t('tutorEarnings.title')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 0, listStyle: 'none', margin: '16px 0' }}>
        {stats.map((st) => (
          <li key={st.key}>
            <Card size="small"><Statistic title={st.label} value={st.value} /></Card>
          </li>
        ))}
        <li>
          <Card size="small">
            <Statistic title={t('tutorEarnings.stats.settled')} value={formatVnd(s.settledNetVnd)} />
            <Statistic title={t('tutorEarnings.stats.unsettled')} value={formatVnd(s.unsettledNetVnd)} />
          </Card>
        </li>
      </ul>
      <Typography.Paragraph type="secondary">
        {s.feeRate === null ? t('tutorEarnings.feeNoteMixed') : t('tutorEarnings.feeNote', { percent: percent(s.feeRate) })}{' '}
        {t('tutorEarnings.monthNote')}
      </Typography.Paragraph>
    </div>
  );
}

function SettlementTag({ item }: { item: TutorEarningItem }) {
  const { t } = useTranslation();
  return item.settled
    ? <Tag color="green">{t('tutorEarnings.detail.settled')}{item.settledAt ? ` (${formatDate(item.settledAt)})` : ''}</Tag>
    : <Tag color="orange">{t('tutorEarnings.detail.unsettled')}</Tag>;
}

function DetailSection({ month }: { month: string }) {
  const { t } = useTranslation();
  const [settlement, setSettlement] = useState<EarningSettlementFilter>('all');
  const [sort, setSort] = useState<EarningSort>('startAt:desc');
  const [page, setPage] = useState(1);
  const query = useMyEarningItems({ month, settlement, page, pageSize: PAGE_SIZE, sort });

  const columns: TableColumnsType<TutorEarningItem> = [
    { title: t('tutorEarnings.detail.code'), dataIndex: 'code' },
    { title: t('tutorEarnings.detail.student'), dataIndex: 'studentName' },
    { title: t('tutorEarnings.detail.time'), key: 'time', render: (_, i) => `${formatDate(i.startAt)} ${formatTimeRange(i.startAt, i.endAt)}` },
    { title: t('tutorEarnings.detail.price'), dataIndex: 'priceVnd', align: 'right', render: formatVnd },
    { title: t('tutorEarnings.detail.fee'), dataIndex: 'platformFeeVnd', align: 'right', render: formatVnd },
    { title: t('tutorEarnings.detail.net'), dataIndex: 'netVnd', align: 'right', render: formatVnd },
    { title: t('tutorEarnings.detail.status'), key: 'status', render: (_, i) => <SettlementTag item={i} /> },
  ];

  return (
    <section aria-labelledby="earnings-detail-title">
      <Typography.Title level={4} id="earnings-detail-title">{t('tutorEarnings.detail.title')}</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Radio.Group
          aria-label={t('tutorEarnings.detail.filter')}
          optionType="button"
          value={settlement}
          onChange={(e) => { setSettlement(e.target.value as EarningSettlementFilter); setPage(1); }}
          options={(['all', 'settled', 'unsettled'] as const).map((v) => ({ value: v, label: t(`tutorEarnings.detail.${v}`) }))}
        />
        <Select
          aria-label={t('tutorEarnings.detail.sort')}
          value={sort}
          onChange={(v) => { setSort(v); setPage(1); }}
          style={{ minWidth: 180 }}
          options={[
            { value: 'startAt:desc', label: t('tutorEarnings.detail.sortDesc') },
            { value: 'startAt:asc', label: t('tutorEarnings.detail.sortAsc') },
          ]}
        />
      </Space>
      {query.isError ? (
        <ErrorState message={t('tutorEarnings.detail.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Table<TutorEarningItem>
            rowKey="bookingId"
            size="small"
            loading={query.isPending}
            columns={columns}
            dataSource={query.data?.items ?? []}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: t('tutorEarnings.detail.empty') }}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          />
          {query.data ? <ExtraSections data={query.data} /> : null}
        </>
      )}
    </section>
  );
}

function ExtraSections({ data }: { data: NonNullable<ReturnType<typeof useMyEarningItems>['data']> }) {
  const { t } = useTranslation();
  return (
    <Collapse
      style={{ marginTop: 16 }}
      items={[
        {
          key: 'cancelled',
          label: `${t('tutorEarnings.cancelled.title')} (${t('tutorEarnings.cancelled.count', { count: data.cancelled.length })})`,
          children: data.cancelled.length === 0 ? (
            <Typography.Text>{t('tutorEarnings.cancelled.none')}</Typography.Text>
          ) : (
            <>
              <Typography.Paragraph type="secondary">{t('tutorEarnings.cancelled.notCounted')}</Typography.Paragraph>
              <List
                dataSource={data.cancelled}
                renderItem={(c) => (
                  <List.Item>
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label={t('tutorEarnings.detail.code')}>{c.code} · {c.studentName}</Descriptions.Item>
                      <Descriptions.Item label={t('tutorEarnings.detail.time')}>{formatDate(c.startAt)} {formatTimeRange(c.startAt, c.endAt)}</Descriptions.Item>
                      <Descriptions.Item label={t('tutorEarnings.detail.price')}>{formatVnd(c.priceVnd)}</Descriptions.Item>
                      <Descriptions.Item label={t('tutorEarnings.detail.status')}>
                        <Tag color="red">{c.refunded ? t('tutorEarnings.cancelled.refunded') : t('tutorEarnings.cancelled.cancelled')}</Tag>
                        {c.cancelledByRole ? t('tutorEarnings.cancelled.byRole', { role: t(`tutorEarnings.cancelled.roles.${c.cancelledByRole}`) }) : null}
                        {c.tutorCancelReason ? ` · ${t('tutorEarnings.cancelled.reason', { reason: c.tutorCancelReason })}` : null}
                      </Descriptions.Item>
                    </Descriptions>
                  </List.Item>
                )}
              />
            </>
          ),
        },
        ...(data.adjustments.length > 0
          ? [{
              key: 'adjustments',
              label: `${t('tutorEarnings.adjustments.title')} (${t('tutorEarnings.cancelled.count', { count: data.adjustments.length })})`,
              children: (
                <>
                  <Typography.Paragraph type="secondary">{t('tutorEarnings.adjustments.hint')}</Typography.Paragraph>
                  <List
                    dataSource={data.adjustments}
                    renderItem={(a) => (
                      <List.Item>
                        <span>{a.code} · {a.studentName} · {formatDateTime(a.startAt)} · {t('tutorEarnings.adjustments.refundedAt', { date: formatDate(a.refundedAt) })}</span>
                        <strong>{formatVnd(a.amountVnd)}</strong>
                      </List.Item>
                    )}
                  />
                </>
              ),
            }]
          : []),
      ]}
    />
  );
}

/** S-29 earnings overview + S-30 month detail (read-only). */
export default function TutorEarningsPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(monthKey());
  return (
    <Card>
      <Typography.Title level={3}>{t('tutorEarnings.title')}</Typography.Title>
      <Space align="center" style={{ marginBottom: 8 }}>
        <label htmlFor="earnings-month">{t('tutorEarnings.month')}</label>
        <Select id="earnings-month" aria-label={t('tutorEarnings.monthHint')} value={month} onChange={setMonth} options={MONTH_OPTIONS} style={{ minWidth: 140 }} />
      </Space>
      <SummarySection month={month} />
      <DetailSection key={month} month={month} />
    </Card>
  );
}
