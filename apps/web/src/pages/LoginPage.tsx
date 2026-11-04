import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Form, Typography } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { errorText } from '../api/errors';
import { useLogin } from '../api/hooks';
import { defaultHome, ROUTES } from '../auth/routes';
import { TextField } from '../components/FormFields';
import { safeNext } from '../lib/safeNext';

const schema = z.object({
  email: z.email('validation.emailInvalid').min(1, 'validation.emailRequired'),
  password: z.string().min(1, 'validation.passwordRequired'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const login = useLogin();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit((values) => {
    setError(null);
    login.mutate(values, {
      onSuccess: (me) => {
        if (me.mustChangePassword) navigate(ROUTES.forcePassword, { replace: true });
        else navigate(next ?? defaultHome(me), { replace: true });
      },
      onError: (err) => setError(errorText(err)),
    });
  });

  return (
    <Card style={{ maxWidth: 420, margin: '32px auto' }}>
      <Typography.Title level={3}>{t('auth.loginTitle')}</Typography.Title>
      {next ? <Alert type="info" showIcon message={t('auth.loginRequiredToBook')} style={{ marginBottom: 16 }} /> : null}
      <Form layout="vertical" onFinish={onSubmit} noValidate>
        {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
        <TextField control={control} name="email" label={t('auth.email')} type="email" autoComplete="username" />
        <TextField
          control={control}
          name="password"
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
        />
        <Button type="primary" htmlType="submit" block loading={login.isPending}>
          {t('auth.loginSubmit')}
        </Button>
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        {t('auth.noAccount')}{' '}
        <Link to={next ? `${ROUTES.register}?next=${encodeURIComponent(next)}` : ROUTES.register}>
          {t('nav.register')}
        </Link>
      </Typography.Paragraph>
    </Card>
  );
}
