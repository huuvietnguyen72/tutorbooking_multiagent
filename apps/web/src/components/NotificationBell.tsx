import { BellOutlined } from '@ant-design/icons';
import { App, Badge, Button, List, Popover, Skeleton, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  NOTIFICATIONS_PAGE_SIZE,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '../api/hooks';
import type { AppNotification, UserRole } from '../api/types';
import { ROUTES } from '../auth/routes';
import { formatDateTime } from '../lib/time';
import { EmptyState, ErrorState } from './States';

/** Where a notification leads; null when it has no related page. */
export function notificationLink(n: AppNotification, role: UserRole): string | null {
  if (!n.bookingId) return null;
  if (role === 'TUTOR') return n.type === 'REVIEW_RECEIVED' ? ROUTES.tutorReviews : ROUTES.tutorSession(n.bookingId);
  return ROUTES.booking(n.bookingId);
}

function NotificationPanel({ role, onNavigate }: { role: UserRole; onNavigate: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const list = useNotifications(true);
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const onError = () => void message.error(t('notifications.actionError'));

  const open = (n: AppNotification) => {
    if (!n.isRead) markRead.mutate(n.id, { onError });
    const link = notificationLink(n, role);
    if (link) {
      onNavigate();
      navigate(link);
    }
  };

  const items = list.data?.items ?? [];
  let content;
  if (list.isPending) content = <Skeleton active paragraph={{ rows: 3 }} aria-busy="true" />;
  else if (list.isError) content = <ErrorState message={t('notifications.loadError')} onRetry={() => void list.refetch()} />;
  else if (items.length === 0) content = <EmptyState title={t('notifications.empty')} hint={t('notifications.emptyHint')} />;
  else
    content = (
      <>
        <List
          aria-label={t('notifications.title')}
          dataSource={items}
          renderItem={(n) => {
            const link = notificationLink(n, role);
            return (
              <List.Item
                key={n.id}
                data-unread={!n.isRead}
                style={{ background: n.isRead ? undefined : 'rgba(22,119,255,0.06)', paddingInline: 8 }}
                actions={[
                  ...(link ? [<Button key="view" type="link" size="small" onClick={() => open(n)}>{t('notifications.view')}</Button>] : []),
                  ...(!n.isRead
                    ? [
                        <Button
                          key="read"
                          type="link"
                          size="small"
                          aria-label={`${t('notifications.markRead')}: ${n.title}`}
                          onClick={() => markRead.mutate(n.id, { onError })}
                        >
                          {t('notifications.markRead')}
                        </Button>,
                      ]
                    : []),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Typography.Text strong={!n.isRead}>
                      {!n.isRead && <Badge status="processing" aria-label={t('notifications.unread')} style={{ marginRight: 6 }} />}
                      {n.title}
                    </Typography.Text>
                  }
                  description={
                    <>
                      <div>{n.body}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(n.createdAt)} · {n.isRead ? t('notifications.read') : t('notifications.unread')}
                      </Typography.Text>
                    </>
                  }
                />
              </List.Item>
            );
          }}
        />
        {list.data && list.data.total > NOTIFICATIONS_PAGE_SIZE ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('notifications.more', { shown: items.length, total: list.data.total })}
          </Typography.Text>
        ) : null}
      </>
    );

  return (
    <div style={{ width: 'min(380px, calc(100vw - 32px))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>{t('notifications.title')}</Typography.Text>
        <Button
          size="small"
          loading={markAll.isPending}
          disabled={!unread.data?.count}
          onClick={() => markAll.mutate(undefined, { onError })}
        >
          {t('notifications.markAllRead')}
        </Button>
      </div>
      <div style={{ maxHeight: 'min(60vh, 420px)', overflowY: 'auto' }}>{content}</div>
    </div>
  );
}

export default function NotificationBell({ role }: { role: UserRole }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useUnreadCount();
  const count = data?.count ?? 0;
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      destroyTooltipOnHide
      content={<NotificationPanel role={role} onNavigate={() => setOpen(false)} />}
    >
      <Button
        type="text"
        style={{ color: '#fff' }}
        aria-label={count > 0 ? t('notifications.bellUnread', { count }) : t('notifications.bell')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Badge count={count} size="small" overflowCount={99}>
          <BellOutlined style={{ color: '#fff', fontSize: 18 }} />
        </Badge>
      </Button>
    </Popover>
  );
}
