import { Button, Card, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '../../api/errors';
import { useAdminSetUserStatus, useAdminUsers } from '../../api/hooks';
import type { AdminUser, UserRole, UserStatus } from '../../api/types';
import { EmptyState, ErrorState } from '../../components/States';
import { ReasonModal } from '../../components/ReasonModal';
import { formatDateTime } from '../../lib/time';

const PAGE_SIZE = 20;
const ROLES: UserRole[] = ['STUDENT', 'TUTOR', 'ADMIN'];
const STATUSES: UserStatus[] = ['ACTIVE', 'LOCKED'];

/** S-26: search/filter users, lock and unlock. Admin accounts can never be locked (A3). */
export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole>();
  const [status, setStatus] = useState<UserStatus>();
  const [locking, setLocking] = useState<AdminUser | null>(null);
  const query = useAdminUsers({ q: q || undefined, role, status, page, pageSize: PAGE_SIZE });
  const setStatusMutation = useAdminSetUserStatus();
  const [modal, modalHolder] = Modal.useModal();

  const unlock = (user: AdminUser) =>
    modal.confirm({
      title: t('admin.users.unlockTitle', { email: user.email }),
      content: t('admin.users.unlockBody'),
      okText: t('admin.users.unlock'),
      cancelText: t('admin.close'),
      onOk: async () => {
        try {
          await setStatusMutation.mutateAsync({ userId: user.id!, status: 'ACTIVE' });
          void message.success(t('admin.users.unlocked'));
        } catch (err) {
          void message.error(errorText(err));
        }
      },
    });

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <Card>
      <Typography.Title level={3}>{t('admin.users.title')}</Typography.Title>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          aria-label={t('admin.users.search')}
          placeholder={t('admin.users.search')}
          onSearch={resetPage(setQ)}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          aria-label={t('admin.users.role')}
          placeholder={t('admin.users.role')}
          value={role}
          onChange={resetPage(setRole)}
          style={{ width: 160 }}
          options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))}
        />
        <Select
          allowClear
          aria-label={t('admin.users.status')}
          placeholder={t('admin.users.status')}
          value={status}
          onChange={resetPage(setStatus)}
          style={{ width: 160 }}
          options={STATUSES.map((s) => ({ value: s, label: t(`admin.userStatus.${s}`) }))}
        />
      </Space>
      {query.isError ? (
        <ErrorState message={t('admin.users.loadError')} onRetry={() => void query.refetch()} />
      ) : (
        <Table<AdminUser>
          rowKey="id"
          loading={query.isPending}
          dataSource={query.data?.items ?? []}
          locale={{ emptyText: <EmptyState title={t('admin.users.empty')} /> }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: query.data?.total ?? 0, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: t('admin.users.name'), dataIndex: 'fullName' },
            { title: t('admin.users.email'), dataIndex: 'email' },
            { title: t('admin.users.role'), dataIndex: 'role', render: (r: UserRole) => t(`role.${r}`) },
            {
              title: t('admin.users.status'),
              dataIndex: 'status',
              render: (s: UserStatus) => <Tag color={s === 'ACTIVE' ? 'green' : 'red'}>{t(`admin.userStatus.${s}`)}</Tag>,
            },
            { title: t('admin.users.createdAt'), dataIndex: 'createdAt', render: (v?: string) => (v ? formatDateTime(v) : '') },
            {
              title: t('admin.actions'),
              render: (_, u) =>
                u.role === 'ADMIN' ? (
                  <Tooltip title={t('admin.users.cannotLockAdmin')}>
                    <span><Button size="small" disabled>{t('admin.users.lock')}</Button></span>
                  </Tooltip>
                ) : u.status === 'LOCKED' ? (
                  <Button size="small" onClick={() => unlock(u)}>{t('admin.users.unlock')}</Button>
                ) : (
                  <Button size="small" danger onClick={() => setLocking(u)}>{t('admin.users.lock')}</Button>
                ),
            },
          ]}
        />
      )}
      {locking ? (
        <ReasonModal
          title={t('admin.users.lockTitle', { email: locking.email })}
          okText={t('admin.users.lock')}
          warning={t('admin.users.lockBody')}
          required={false}
          danger
          onSubmit={(reason) => setStatusMutation.mutateAsync({ userId: locking.id!, status: 'LOCKED', reason: reason || undefined })}
          onClose={() => setLocking(null)}
        />
      ) : null}
      {modalHolder}
    </Card>
  );
}
