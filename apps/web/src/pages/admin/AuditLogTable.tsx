import { Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminAuditLogs } from '../../api/hooks';
import type { AuditLog, AuditLogParams } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { formatDateTime } from '../../lib/time';

const PAGE_SIZE = 20;

/** Audit trail (US-ADM-04), optionally narrowed to one entity. Actions without a translation show the raw code. */
export function AuditLogTable({ filter }: { filter?: Pick<AuditLogParams, 'entityType' | 'entityId'> }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useAdminAuditLogs({ ...filter, page, pageSize: PAGE_SIZE });

  if (query.isError) return <ErrorState message={t('admin.audit.loadError')} onRetry={() => void query.refetch()} />;
  const label = (prefix: string, value: string) => (i18n.exists(`${prefix}.${value}`) ? t(`${prefix}.${value}`) : value);

  return (
    <Table<AuditLog>
      rowKey="id"
      size="small"
      loading={query.isPending}
      dataSource={query.data?.items ?? []}
      locale={{ emptyText: <EmptyState title={t('admin.audit.empty')} /> }}
      pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
      scroll={{ x: 'max-content' }}
      columns={[
        { title: t('admin.audit.time'), dataIndex: 'createdAt', render: (v: string) => formatDateTime(v) },
        { title: t('admin.audit.action'), dataIndex: 'action', render: (v?: string) => label('admin.audit.actions', v ?? '') },
        { title: t('admin.audit.entity'), render: (_, r) => `${label('admin.audit.entities', r.entityType ?? '')} · ${r.entityId}` },
        { title: t('admin.audit.actor'), dataIndex: 'actorId', render: (v: string | null) => v ?? t('admin.audit.system') },
        { title: t('admin.reason'), dataIndex: 'reason', render: (v: string | null) => v ?? '' },
      ]}
    />
  );
}
