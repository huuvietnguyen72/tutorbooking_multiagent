import { Alert, Button, Empty, Result, Skeleton } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert
      type="error"
      showIcon
      role="alert"
      message={message ?? t('errors.UNKNOWN')}
      action={onRetry ? <Button onClick={onRetry}>{t('app.retry')}</Button> : undefined}
    />
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Empty description={<div><div>{title}</div>{hint ? <div>{hint}</div> : null}</div>}>
      {action}
    </Empty>
  );
}

export function CardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} active avatar paragraph={{ rows: 2 }} style={{ marginBottom: 16 }} />
      ))}
    </div>
  );
}

export function StatusPage({ status, extra }: { status: '403' | '404' | '500'; extra?: ReactNode }) {
  const { t } = useTranslation();
  return <Result status={status} title={status} subTitle={t(`errorPage.${status}`)} extra={extra} />;
}
