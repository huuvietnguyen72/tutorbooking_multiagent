import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Form, Typography, message } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { errorText } from '../api/errors';
import { useChangePassword, useMe } from '../api/hooks';
import { defaultHome, ROUTES } from '../auth/routes';
import { TextField } from '../components/FormFields';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'validation.currentPasswordRequired'),
    newPassword: z.string().min(8, 'validation.passwordMin').max(128, 'validation.passwordMax'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'validation.passwordMismatch' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'validation.passwordSame' });
type Values = z.infer<typeof schema>;

/** Used for both the forced change (`/doi-mat-khau`) and the voluntary one inside the account page. */
export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const change = useChangePassword();
  const [error, setError] = useState<string | null>(null);
  const [wrongCurrent, setWrongCurrent] = useState<string | undefined>();
  const { control, handleSubmit, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const onSubmit = handleSubmit((values) => {
    setError(null);
    setWrongCurrent(undefined);
    change.mutate(
      { currentPassword: values.currentPassword, newPassword: values.newPassword },
      {
        onSuccess: () => {
          reset();
          if (forced) navigate(me ? defaultHome({ ...me, mustChangePassword: false }) : ROUTES.home, { replace: true });
          else void message.success(t('changePassword.success'));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'WRONG_CURRENT_PASSWORD') setWrongCurrent(errorText(err));
          else setError(errorText(err));
        },
      },
    );
  });

  return (
    <Form layout="vertical" onFinish={onSubmit} noValidate>
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
      <TextField control={control} name="currentPassword" label={t('changePassword.current')} type="password" autoComplete="current-password" serverError={wrongCurrent} />
      <TextField control={control} name="newPassword" label={t('changePassword.new')} type="password" autoComplete="new-password" extra={t('auth.passwordHint')} />
      <TextField control={control} name="confirm" label={t('changePassword.confirm')} type="password" autoComplete="new-password" />
      <Button type="primary" htmlType="submit" loading={change.isPending}>
        {t('changePassword.submit')}
      </Button>
    </Form>
  );
}

export default function ForcedChangePasswordPage() {
  const { t } = useTranslation();
  return (
    <Card style={{ maxWidth: 420, margin: '32px auto' }}>
      <Typography.Title level={3}>{t('changePassword.forcedTitle')}</Typography.Title>
      <Alert type="warning" showIcon message={t('changePassword.forcedNote')} style={{ marginBottom: 16 }} />
      <ChangePasswordForm forced />
    </Card>
  );
}
