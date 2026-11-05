import { Card, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { AuditLogTable } from './AuditLogTable';

/** Global audit log (admin actions and automatic refunds). */
export default function AdminAuditPage() {
  const { t } = useTranslation();
  return (
    <Card>
      <Typography.Title level={3}>{t('admin.audit.title')}</Typography.Title>
      <AuditLogTable />
    </Card>
  );
}
