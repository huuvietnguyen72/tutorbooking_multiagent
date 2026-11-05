import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../../api/errors';
import { useAdminTutorDecision, useAdminTutors } from '../../api/hooks';
import type { AdminTutor, TutorAction, TutorApprovalStatus } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { ReasonModal } from '../../components/ReasonModal';
import { formatVnd } from '../../lib/format';
import { formatDateTime } from '../../lib/time';

const PAGE_SIZE = 20;
const STATUSES: TutorApprovalStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const STATUS_COLOR: Record<TutorApprovalStatus, string> = {
  PENDING_APPROVAL: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
  SUSPENDED: 'default',
};

/** Which decisions the state machine allows from each status (server enforces; this only picks the buttons). */
const ACTIONS: Record<TutorApprovalStatus, TutorAction[]> = {
  PENDING_APPROVAL: ['approve', 'reject'],
  APPROVED: ['suspend'],
  SUSPENDED: ['reinstate'],
  REJECTED: [],
};

export function ApprovalTag({ status }: { status: TutorApprovalStatus }) {
  const { t } = useTranslation();
  return <Tag color={STATUS_COLOR[status]}>{t(`admin.approvalStatus.${status}`)}</Tag>;
}

/** S-25: tutor approval queue with a detail drawer; reject needs a reason, suspend asks for confirmation. */
export default function AdminTutorsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [approvalStatus, setApprovalStatus] = useState<TutorApprovalStatus | undefined>('PENDING_APPROVAL');
  const [selected, setSelected] = useState<AdminTutor | null>(null);
  const [rejecting, setRejecting] = useState<AdminTutor | null>(null);
  const query = useAdminTutors({ q: q || undefined, approvalStatus, page, pageSize: PAGE_SIZE });
  const decide = useAdminTutorDecision();
  const [modal, modalHolder] = Modal.useModal();

  const run = async (tutor: AdminTutor, action: TutorAction, reason?: string) => {
    const updated = await decide.mutateAsync({ tutorId: tutor.id, action, reason });
    setSelected(updated);
    void message.success(t(`admin.tutors.done.${action}`));
  };

  const act = (tutor: AdminTutor, action: TutorAction) => {
    if (action === 'reject') return setRejecting(tutor);
    if (action === 'approve') {
      void run(tutor, action).catch((err) => void message.error(errorText(err)));
      return;
    }
    modal.confirm({
      title: t(`admin.tutors.confirm.${action}.title`, { name: tutor.fullName }),
      content: t(`admin.tutors.confirm.${action}.body`),
      okText: t(`admin.tutors.action.${action}`),
      okButtonProps: { danger: action === 'suspend' },
      cancelText: t('admin.close'),
      onOk: () => run(tutor, action).catch((err) => void message.error(errorText(err))),
    });
  };

  const buttons = (tutor: AdminTutor) =>
    ACTIONS[tutor.approvalStatus].map((action) => (
      <Button
        key={action}
        type={action === 'approve' ? 'primary' : 'default'}
        danger={action === 'reject' || action === 'suspend'}
        onClick={() => act(tutor, action)}
      >
        {t(`admin.tutors.action.${action}`)}
      </Button>
    ));

  return (
    <Card>
      <Typography.Title level={3}>
        {t('admin.tutors.title')}
        {approvalStatus === 'PENDING_APPROVAL' && query.data ? ` (${query.data.total})` : ''}
      </Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          aria-label={t('admin.tutors.status')}
          placeholder={t('admin.tutors.allStatuses')}
          value={approvalStatus}
          onChange={(v) => {
            setApprovalStatus(v);
            setPage(1);
          }}
          style={{ width: 180 }}
          options={STATUSES.map((s) => ({ value: s, label: t(`admin.approvalStatus.${s}`) }))}
        />
        <Input.Search
          allowClear
          aria-label={t('admin.tutors.search')}
          placeholder={t('admin.tutors.search')}
          onSearch={(v) => {
            setQ(v);
            setPage(1);
          }}
          style={{ width: 260 }}
        />
      </Space>
      {query.isError ? (
        <ErrorState message={t('admin.tutors.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<AdminTutor>
          rowKey="id"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: <EmptyState title={approvalStatus === 'PENDING_APPROVAL' ? t('admin.tutors.emptyPending') : t('admin.tutors.empty')} /> }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.tutors.name'), dataIndex: 'fullName' },
            { title: t('admin.tutors.email'), dataIndex: 'email' },
            { title: t('admin.tutors.subjects'), render: (_, r) => r.subjects.map((s) => s.name).join(', ') },
            { title: t('admin.tutors.status'), dataIndex: 'approvalStatus', render: (s: TutorApprovalStatus) => <ApprovalTag status={s} /> },
            { title: t('admin.actions'), render: (_, r) => <Button size="small" onClick={() => setSelected(r)}>{t('admin.tutors.view')}</Button> },
          ]}
        />
      )}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        width={480}
        title={selected?.fullName}
        extra={selected ? <Space>{buttons(selected)}</Space> : null}
        destroyOnHidden
      >
        {selected ? (
          <>
            {decide.isError ? <Alert type="error" showIcon role="alert" message={errorText(decide.error)} style={{ marginBottom: 16 }} /> : null}
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label={t('admin.tutors.email')}>{selected.email}</Descriptions.Item>
              <Descriptions.Item label={t('admin.tutors.status')}><ApprovalTag status={selected.approvalStatus} /></Descriptions.Item>
              <Descriptions.Item label={t('admin.tutors.subjects')}>{selected.subjects.map((s) => s.name).join(', ')}</Descriptions.Item>
              <Descriptions.Item label={t('admin.tutors.price')}>
                {selected.pricePerSessionVnd != null ? formatVnd(selected.pricePerSessionVnd) : t('admin.tutors.noPrice')}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.tutors.experience')}>{selected.experience}</Descriptions.Item>
              <Descriptions.Item label={t('admin.tutors.bio')}>{selected.bio}</Descriptions.Item>
              {selected.rejectionReason ? (
                <Descriptions.Item label={t('admin.tutors.rejectionReason')}>{selected.rejectionReason}</Descriptions.Item>
              ) : null}
              {selected.reviewedAt ? (
                <Descriptions.Item label={t('admin.tutors.reviewedAt')}>{formatDateTime(selected.reviewedAt)}</Descriptions.Item>
              ) : null}
            </Descriptions>
          </>
        ) : null}
      </Drawer>
      {rejecting ? (
        <ReasonModal
          title={t('admin.tutors.rejectTitle', { name: rejecting.fullName })}
          okText={t('admin.tutors.action.reject')}
          danger
          onSubmit={(reason) => run(rejecting, 'reject', reason)}
          onClose={() => setRejecting(null)}
        />
      ) : null}
      {modalHolder}
    </Card>
  );
}
