import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { Alert, Card, Col, Collapse, List, Radio, Row, Select, Skeleton, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMyEarningItems, useMyEarnings } from '../../api/hooks';
import type { EarningsSettlement, EarningsSort, TutorEarningItem, TutorEarningsSummary } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { currentMonth, formatDate, formatDateTime, formatMonth, formatTimeRange, shiftMonth } from '../../lib/time';

const PAGE_SIZE = 10;
const MONTHS_BACK = 23;
const SETTLEMENTS: EarningsSettlement[] = ['all', 'settled', 'unsettled'];
const SORTS: EarningsSort[] = ['startAt:desc', 'startAt:asc'];
const SETTLEMENT_LABEL: Record<EarningsSettlement, string> = {
  all: 'earnings.filterAll',
  settled: 'earnings.filterSettled',
  unsettled: 'earnings.filterUnsettled',
};
const SORT_LABEL: Record<EarningsSort, string> = { 'startAt:desc': 'earnings.sortDesc', 'startAt:asc': 'earnings.sortAsc' };

/** Fee rate as a percentage without trailing noise: 0.1 -> `10`, 0.125 -> `12,5`. */
const formatRate = (rate: number) => (rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

function SummaryCards({ summary }: { summary: TutorEarningsSummary }) {
  const { t } = useTranslation();
  const card = (key: string, title: string, value: number, money = true) => (
    <Col xs={24} sm={12} lg={8} key={key}>
      <Card size="small">
        <Statistic title={title} value={value} formatter={(v) => (money ? formatVnd(Number(v)) : String(v))} />
      </Card>
    </Col>
  );
  return (
    <Row gutter={[16, 16]}>
      {card('count', t('earnings.sessionCount'), summary.sessionCount, false)}
      {card('gross', t('earnings.gross'), summary.grossVnd)}
      {card('fee', t('earnings.fee'), summary.platformFeeVnd)}
      {card('net', t('earnings.net'), summary.netVnd)}
      <Col xs={24} sm={12} lg={8}>
        <Card size="small" title={t('earnings.settlement')} styles={{ header: { minHeight: 0, fontWeight: 400, color: 'rgba(0,0,0,0.45)' } }}>
          <Space direction="vertical" size={4}>
            <Statistic title={t('earnings.settledNet')} value={summary.settledNetVnd} formatter={(v) => formatVnd(Number(v))} />
            <Statistic title={t('earnings.unsettledNet')} value={summary.unsettledNetVnd} formatter={(v) => formatVnd(Number(v))} />
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

function SettlementTag({ settled }: { settled: boolean }) {
  const { t } = useTranslation();
  return settled ? (
    <Tag color="green" icon={<CheckCircleOutlined />}>{t('earnings.settled')}</Tag>
  ) : (
    <Tag color="orange" icon={<ClockCircleOutlined />}>{t('earnings.unsettled')}</Tag>
  );
}

/** S-30: sessions behind the month's figures, with the cancelled/refunded ones folded away. */
function MonthDetail({ month }: { month: string }) {
  const { t } = useTranslation();
  const [settlement, setSettlement] = useState<EarningsSettlement>('all');
  const [sort, setSort] = useState<EarningsSort>('startAt:desc');
  const [page, setPage] = useState(1);
  const query = useMyEarningItems({ month, settlement, page, pageSize: PAGE_SIZE, sort });

  const columns: ColumnsType<TutorEarningItem> = [
    { title: t('earnings.code'), dataIndex: 'code', key: 'code' },
    { title: t('earnings.student'), dataIndex: 'studentName', key: 'student' },
    { title: t('earnings.time'), key: 'time', render: (_, r) => `${formatDate(r.startAt)} ${formatTimeRange(r.startAt, r.endAt)}` },
    { title: t('earnings.price'), dataIndex: 'priceVnd', key: 'price', align: 'right', render: formatVnd },
    { title: t('earnings.itemFee'), dataIndex: 'platformFeeVnd', key: 'fee', align: 'right', render: formatVnd },
    { title: t('earnings.itemNet'), dataIndex: 'netVnd', key: 'net', align: 'right', render: formatVnd },
    { title: t('earnings.status'), key: 'settled', render: (_, r) => <SettlementTag settled={r.settled} /> },
  ];

  const cancelled = query.data?.cancelled ?? [];
  const adjustments = query.data?.adjustments ?? [];

  return (
    <section aria-labelledby="earnings-detail-title" style={{ marginTop: 24 }}>
      <Typography.Title level={4} id="earnings-detail-title">{t('earnings.detailTitle', { month: formatMonth(month) })}</Typography.Title>
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group
          aria-label={t('earnings.filter')}
          optionType="button"
          value={settlement}
          onChange={(e) => {
            setSettlement(e.target.value as EarningsSettlement);
            setPage(1);
          }}
          options={SETTLEMENTS.map((value) => ({ value, label: t(SETTLEMENT_LABEL[value]) }))}
        />
        <Select
          aria-label={t('earnings.sort')}
          value={sort}
          style={{ minWidth: 170 }}
          onChange={(value) => {
            setSort(value);
            setPage(1);
          }}
          options={SORTS.map((value) => ({ value, label: t(SORT_LABEL[value]) }))}
        />
      </Space>
      {query.isError ? (
        <ErrorState message={t('earnings.itemsLoadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<TutorEarningItem>
          aria-label={t('earnings.tableLabel')}
          rowKey="bookingId"
          size="middle"
          scroll={{ x: 'max-content' }}
          loading={query.isPending}
          columns={columns}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: t('earnings.tableEmpty') }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
        />
      )}
      {query.data ? (
        <Collapse
          style={{ marginTop: 16 }}
          items={[
            {
              key: 'cancelled',
              label: t('earnings.cancelledTitle', { count: cancelled.length + adjustments.length }),
              children: (
                <>
                  <Typography.Paragraph type="secondary">{t('earnings.cancelledNote')}</Typography.Paragraph>
                  {cancelled.length + adjustments.length === 0 ? <Typography.Text>{t('earnings.cancelledNone')}</Typography.Text> : null}
                  {cancelled.length > 0 ? (
                    <List
                      dataSource={cancelled}
                      renderItem={(c) => (
                        <List.Item>
                          <div>
                            <strong>{c.code}</strong> · {c.studentName} · {formatDateTime(c.startAt)} · {formatVnd(c.priceVnd)}{' '}
                            <Tag color={c.refunded ? 'red' : 'default'}>{c.refunded ? t('earnings.refunded') : t('earnings.notRefunded')}</Tag>
                            {c.cancelledByRole ? <Tag>{t(`earnings.cancelledBy.${c.cancelledByRole}`)}</Tag> : null}
                            {c.tutorCancelReason ? <div>{t('earnings.reason', { reason: c.tutorCancelReason })}</div> : null}
                          </div>
                        </List.Item>
                      )}
                    />
                  ) : null}
                  {adjustments.length > 0 ? (
                    <>
                      <Typography.Title level={5}>{t('earnings.adjustmentsTitle')}</Typography.Title>
                      <List
                        dataSource={adjustments}
                        renderItem={(a) => (
                          <List.Item>
                            <div>
                              <strong>{a.code}</strong> · {a.studentName} · {t('earnings.adjustmentItem', { time: formatDateTime(a.refundedAt) })} ·{' '}
                              <strong>{formatVnd(a.amountVnd)}</strong>
                            </div>
                          </List.Item>
                        )}
                      />
                    </>
                  ) : null}
                </>
              ),
            },
          ]}
        />
      ) : null}
    </section>
  );
}

/** S-29: monthly earnings overview; S-30 (details) sits below it. */
export default function TutorEarningsPage() {
  const { t } = useTranslation();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const query = useMyEarnings(month);
  const months = Array.from({ length: MONTHS_BACK + 1 }, (_, i) => shiftMonth(now, -i));

  return (
    <Card>
      <Typography.Title level={3}>{t('earnings.title')}</Typography.Title>
      <Space style={{ marginBottom: 16 }}>
        <label htmlFor="earnings-month">{t('earnings.month')}</label>
        <Select
          id="earnings-month"
          aria-label={t('earnings.monthPicker')}
          value={month}
          style={{ minWidth: 160 }}
          onChange={setMonth}
          options={months.map((m) => ({ value: m, label: t('earnings.monthOption', { month: formatMonth(m) }) }))}
        />
      </Space>

      {query.isPending ? (
        <div aria-busy="true" data-testid="earnings-skeleton">
          <Skeleton active paragraph={{ rows: 4 }} />
        </div>
      ) : query.isError ? (
        <ErrorState message={t('earnings.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.isEmpty ? <EmptyState title={t('earnings.empty')} hint={t('earnings.emptyHint')} /> : null}
          <section aria-label={t('earnings.summaryTitle', { month: formatMonth(month) })} style={{ marginTop: 16 }}>
            <SummaryCards summary={query.data} />
          </section>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 4 }}>
            {query.data.feeRate === null ? t('earnings.feeNoteMixed') : t('earnings.feeNote', { rate: formatRate(query.data.feeRate) })}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t('earnings.monthNote')}</Typography.Paragraph>
          {query.data.adjustmentCount > 0 ? (
            <Alert
              type="info"
              showIcon
              message={t('earnings.adjustmentNote', { amount: formatVnd(query.data.adjustmentsVnd), count: query.data.adjustmentCount })}
            />
          ) : null}
          <MonthDetail key={month} month={month} />
        </>
      )}
    </Card>
  );
}
