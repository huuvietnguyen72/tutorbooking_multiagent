import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, ConfigProvider, Form, Typography } from 'antd';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import './LoginPage.css';
import { errorText } from '../api/errors';
import { useLogin } from '../api/hooks';
import { ROUTES } from '../auth/routes';
import { TextField } from '../components/FormFields';
import { safeNext } from '../lib/safeNext';

const schema = z.object({
  email: z.email('validation.emailInvalid').min(1, 'validation.emailRequired'),
  password: z.string().min(1, 'validation.passwordRequired'),
});
type Values = z.infer<typeof schema>;

/** Red accent scoped to the login page only (nested ConfigProvider); the global theme is untouched. */
const loginTheme = {
  token: {
    colorPrimary: '#B91C1C', // red-700, white text 6.5:1
    colorPrimaryHover: '#991B1B', // red-800
    colorPrimaryActive: '#7F1D1D', // red-900
    colorLink: '#B91C1C',
    colorLinkHover: '#991B1B',
    colorLinkActive: '#7F1D1D',
    colorPrimaryBorder: '#FECACA',
    controlOutline: 'rgba(220, 38, 38, 0.25)', // red-600 focus ring
  },
  components: {
    Button: { primaryShadow: 'none' },
  },
};

export default function LoginPage() {
  const { t } = useTranslation();
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
    // On success the session lands in the `me` cache and `GuestOnly` picks the destination
    // (including `?next=`), so there is a single place that decides where to go.
    login.mutate(values, {
      onError: (err) => setError(errorText(err)),
    });
  });

  return (
    <ConfigProvider theme={loginTheme}>
    <div className="login-red">
    <Card className="login-red__card" style={{ maxWidth: 420, margin: '0 auto' }}>
      <Typography.Title level={3} className="login-red__title">{t('auth.loginTitle')}</Typography.Title>
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
    </div>
    </ConfigProvider>
  );
}
