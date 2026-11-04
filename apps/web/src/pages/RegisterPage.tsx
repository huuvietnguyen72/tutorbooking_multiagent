import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Form, Radio, Typography } from 'antd';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { errorText, fieldErrorText } from '../api/errors';
import { useRegister } from '../api/hooks';
import { defaultHome, ROUTES } from '../auth/routes';
import { TextField } from '../components/FormFields';
import { safeNext } from '../lib/safeNext';

const schema = z.object({
  role: z.enum(['STUDENT', 'TUTOR']),
  fullName: z.string().trim().min(1, 'validation.fullNameRequired').max(100, 'validation.fullNameMax'),
  email: z.email('validation.emailInvalid').max(254, 'validation.emailInvalid'),
  password: z.string().min(8, 'validation.passwordMin').max(128, 'validation.passwordMax'),
});
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const registerMutation = useRegister();
  const [error, setError] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Partial<Record<keyof Values, string>>>({});
  const { control, handleSubmit, watch } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'STUDENT', fullName: '', email: '', password: '' },
  });
  const role = watch('role');

  const onSubmit = handleSubmit((values) => {
    setError(null);
    setServerFields({});
    registerMutation.mutate(values, {
      onSuccess: (me) => navigate(me.role === 'STUDENT' && next ? next : defaultHome(me), { replace: true }),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') {
          setServerFields({ email: t('errors.EMAIL_TAKEN') });
        } else if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.fieldErrors.length > 0) {
          const mapped: Partial<Record<keyof Values, string>> = {};
          for (const f of err.fieldErrors) {
            if (f.field in schema.shape) mapped[f.field as keyof Values] = fieldErrorText(f.code);
          }
          setServerFields(mapped);
          if (Object.keys(mapped).length === 0) setError(errorText(err));
        } else {
          setError(errorText(err));
        }
      },
    });
  });

  return (
    <Card style={{ maxWidth: 420, margin: '32px auto' }}>
      <Typography.Title level={3}>{t('auth.registerTitle')}</Typography.Title>
      <Form layout="vertical" onFinish={onSubmit} noValidate>
        {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
        <Form.Item label={t('auth.iAm')}>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Radio.Group {...field} aria-label={t('auth.iAm')}>
                <Radio value="STUDENT">{t('auth.roleStudent')}</Radio>
                <Radio value="TUTOR">{t('auth.roleTutor')}</Radio>
              </Radio.Group>
            )}
          />
        </Form.Item>
        <TextField control={control} name="fullName" label={t('auth.fullName')} autoComplete="name" serverError={serverFields.fullName} />
        <TextField control={control} name="email" label={t('auth.email')} type="email" autoComplete="username" serverError={serverFields.email} />
        <TextField
          control={control}
          name="password"
          label={t('auth.password')}
          type="password"
          autoComplete="new-password"
          extra={t('auth.passwordHint')}
          serverError={serverFields.password}
        />
        <Button type="primary" htmlType="submit" block loading={registerMutation.isPending}>
          {t('auth.registerSubmit')}
        </Button>
        {role === 'TUTOR' ? (
          <Alert type="info" showIcon message={t('auth.tutorApprovalNote')} style={{ marginTop: 16 }} />
        ) : null}
      </Form>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
        {t('auth.hasAccount')} <Link to={ROUTES.login}>{t('nav.login')}</Link>
      </Typography.Paragraph>
    </Card>
  );
}
