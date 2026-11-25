import { Alert, Button, Card, DatePicker, Drawer, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorText } from '../../api/errors';
import { useAdminEarnings, useAdminSettleMonth, useAdminTutorEarningItems } from '../../api/hooks';
import type { AdminEarningItem, AdminEarningsRow, SettlementResult } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { formatVnd } from '../../lib/format';
import { currentMonthKey, formatDateTime, formatSession, monthPickerRange } from '../../lib/time';

const PAGE_SIZE = 20;
const ITEMS_PAGE_SIZE = 20;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Read-only list of one tutor's sessions in the month (no per-session settling: settlement is per tutor and month). */
function EarningItemsDrawer({ tutor, month, onClose }: { tutor: AdminEarningsRow | null; month: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useAdminTutorEarningItems(tutor?.tutorId ?? null, month, page, ITEMS_PAGE_SIZE);
  return (
    <Drawer
      open={tutor !== null}
      onClose={onClose}
      width={Math.min(900, window.innerWidth)}
      title={tutor ? t('admin.earnings.detailsTitle', { name: tutor.tutorName, month }) : ''}
      afterOpenChange={(open) => open || setPage(1)}
    >
      {query.isError ? (
        <ErrorState message={t('admin.earnings.detailsError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<AdminEarningItem>
          rowKey="bookingId"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: <EmptyState title={t('admin.earnings.detailsEmpty')} /> }}
          pagination={{ current: page, pageSize: ITEMS_PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.earnings.code'), dataIndex: 'code' },
            { title: t('admin.earnings.student'), dataIndex: 'studentName' },
            { title: t('admin.earnings.time'), render: (_, r) => formatSession(r.startAt, r.endAt) },
            { title: t('admin.earnings.gross'), dataIndex: 'priceVnd', align: 'right', render: formatVnd },
            { title: t('admin.earnings.fee'), dataIndex: 'platformFeeVnd', align: 'right', render: formatVnd },
            { title: t('admin.earnings.net'), dataIndex: 'netVnd', align: 'right', render: formatVnd },
            {
              title: t('admin.earnings.status'),
              render: (_, r) =>
                r.settled ? (
                  <Tooltip title={r.settledAt ? t('admin.earnings.settledAt') + ': ' + formatDateTime(r.settledAt) : undefined}>
                    <Tag color="green">{t('admin.earnings.isSettled')}</Tag>
                  </Tooltip>
                ) : (
                  <Tag color="orange">{t('admin.earnings.isUnsettled')}</Tag>
                ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}

/** Per-month tutor earnings reconciliation: admins mark a finished month as paid out, one tutor at a time. */
export default function AdminEarningsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('month');
  const { min, max } = monthPickerRange();
  const inRange = raw !== null && MONTH_RE.test(raw) && !dayjs(raw, 'YYYY-MM').isBefore(min) && !dayjs(raw, 'YYYY-MM').isAfter(max);
  const month = inRange ? raw : currentMonthKey();
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminEarningsRow | null>(null);
  const [result, setResult] = useState<SettlementResult | null>(null);
  const query = useAdminEarnings(month, page, PAGE_SIZE);
  const settle = useAdminSettleMonth();
  const [modal, modalHolder] = Modal.useModal();

  const monthClosed = query.data?.monthClosed ?? false;

  const confirmSettle = (row: AdminEarningsRow) =>
    modal.confirm({
      title: t('admin.earnings.settleTitle', { month, name: row.tutorName }),
      content: t('admin.earnings.settleBody', { count: row.unsettledCount, amount: formatVnd(row.unsettledNetVnd) }),
      okText: t('admin.earnings.settleOk'),
      cancelText: t('admin.close'),
      onOk: async () => {
        try {
          const res = await settle.mutateAsync({ tutorId: row.tutorId, month });
          setResult(res);
          void message.success(t('admin.earnings.settled', { count: res.settledCount, amount: formatVnd(res.settledNetVnd) }));
        } catch (err) {
          setResult(null);
          void message.error(errorText(err));
        }
      },
    });

  const changeMonth = (value: dayjs.Dayjs | null) => {
    if (!value) return;
    setParams({ month: value.format('YYYY-MM') }, { replace: true });
    setPage(1);
    setResult(null);
  };

  return (
    <Card>
      <Typography.Title level={3}>{t('admin.earnings.title')}</Typography.Title>
      <Space wrap align="center" style={{ marginBottom: 16 }}>
        <label htmlFor="earnings-month">{t('admin.earnings.month')}</label>
        <DatePicker
          id="earnings-month"
          picker="month"
          allowClear={false}
          format="MM/YYYY"
          value={dayjs(month, 'YYYY-MM')}
          onChange={changeMonth}
          disabledDate={(d) => d.isBefore(min) || d.isAfter(max)}
        />
        <Typography.Text type="secondary">{t('admin.earnings.monthHint')}</Typography.Text>
      </Space>
      {result ? (
        <Alert
          type="success"
          showIcon
          closable
          onClose={() => setResult(null)}
          style={{ marginBottom: 16 }}
          message={t('admin.earnings.settled', { count: result.settledCount, amount: formatVnd(result.settledNetVnd) })}
          description={result.alreadySettledCount > 0 ? t('admin.earnings.alreadySettled', { count: result.alreadySettledCount }) : undefined}
        />
      ) : null}
      {query.isError ? (
        <ErrorState message={t('admin.earnings.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<AdminEarningsRow>
          rowKey="tutorId"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: <EmptyState title={t('admin.earnings.empty')} /> }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.earnings.tutor'), dataIndex: 'tutorName' },
            { title: t('admin.earnings.sessions'), dataIndex: 'sessionCount', align: 'right' },
            { title: t('admin.earnings.net'), dataIndex: 'netVnd', align: 'right', render: formatVnd },
            { title: t('admin.earnings.settledNet'), dataIndex: 'settledNetVnd', align: 'right', render: formatVnd },
            { title: t('admin.earnings.unsettledNet'), dataIndex: 'unsettledNetVnd', align: 'right', render: formatVnd },
            {
              title: t('admin.actions'),
              render: (_, row) => {
                const hint = !monthClosed ? t('admin.earnings.monthOpen') : row.unsettledCount === 0 ? t('admin.earnings.nothingToSettle') : undefined;
                return (
                  <Space>
                    <Button size="small" onClick={() => setDetail(row)} aria-label={`${t('admin.earnings.details')} ${row.tutorName}`}>
                      {t('admin.earnings.details')}
                    </Button>
                    <Tooltip title={hint}>
                      <span>
                        <Button
                          size="small"
                          type="primary"
                          disabled={hint !== undefined}
                          onClick={() => confirmSettle(row)}
                          aria-label={`${t('admin.earnings.settle')} ${row.tutorName}`}
                        >
                          {t('admin.earnings.settle')}
                        </Button>
                      </span>
                    </Tooltip>
                  </Space>
                );
              },
            },
          ]}
        />
      )}
      <EarningItemsDrawer tutor={detail} month={month} onClose={() => setDetail(null)} />
      {modalHolder}
    </Card>
  );
}
