import { Card, Descriptions, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/hooks';
import { ChangePasswordForm } from './ChangePasswordPage';

export default function AccountPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Typography.Title level={3}>{t('account.title')}</Typography.Title>
      {me ? (
        <Card title={t('account.profile')} style={{ marginBottom: 16 }}>
          <Descriptions column={1}>
            <Descriptions.Item label={t('auth.fullName')}>{me.fullName}</Descriptions.Item>
            <Descriptions.Item label={t('auth.email')}>{me.email}</Descriptions.Item>
            <Descriptions.Item label={t('auth.iAm')}>{t(`role.${me.role}`)}</Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}
      <Card title={t('changePassword.title')}>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
