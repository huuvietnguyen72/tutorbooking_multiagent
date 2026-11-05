import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Avatar, Button, Card, Form, Input, InputNumber, Select, Skeleton, Space, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { errorText, fieldErrorText } from '../../api/errors';
import {
  usePublicConfig,
  useResubmitProfile,
  useSaveProfile,
  useSubjects,
  useMyProfile,
  useUploadAvatar,
} from '../../api/hooks';
import { ErrorState } from '../../components/States';
import { TextField } from '../../components/FormFields';
import { initialOf } from '../../lib/format';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png'];

const schema = z.object({
  fullName: z.string().trim().min(1, 'validation.fullNameRequired').max(100, 'validation.fullNameMax'),
  subjectIds: z.array(z.number()).min(1, 'validation.subjectsRequired'),
  experience: z.string().max(2000, 'validation.experienceMax'),
  bio: z.string().max(5000, 'validation.bioMax'),
  pricePerSessionVnd: z
    .number('validation.priceInvalid')
    .int('validation.priceInvalid')
    .gt(0, 'validation.priceInvalid'),
});
type Values = z.infer<typeof schema>;

/** S-17: tutors edit their own profile; REJECTED tutors can save and resubmit in one step. */
export default function TutorProfilePage() {
  const { t, i18n } = useTranslation();
  const profile = useMyProfile();
  const subjects = useSubjects();
  const config = usePublicConfig();
  const save = useSaveProfile();
  const resubmit = useResubmitProfile();
  const upload = useUploadAvatar();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { control, handleSubmit, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', subjectIds: [], experience: '', bio: '', pricePerSessionVnd: undefined },
  });

  const data = profile.data;
  useEffect(() => {
    if (!data) return;
    reset({
      fullName: data.fullName,
      subjectIds: data.subjects.map((s) => s.id),
      experience: data.experience ?? '',
      bio: data.bio ?? '',
      pricePerSessionVnd: data.pricePerSessionVnd,
    });
  }, [data, reset]);

  if (profile.isPending) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (profile.isError) return <ErrorState message={t('tutorProfile.loadError')} onRetry={() => void profile.refetch()} />;

  const status = profile.data.approvalStatus;
  const rejected = status === 'REJECTED';

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.code === 'VALIDATION_FAILED' && err.fieldErrors.length > 0) {
      setFieldErrors(Object.fromEntries(err.fieldErrors.map((f) => [f.field, fieldErrorText(f.code)])));
    }
    setError(errorText(err));
  };

  const submit = (andResubmit: boolean) =>
    handleSubmit(async (values) => {
      setError(null);
      setFieldErrors({});
      try {
        await save.mutateAsync(values);
        if (andResubmit) {
          await resubmit.mutateAsync();
          void message.success(t('tutorProfile.resubmitted'));
        } else {
          void message.success(t('tutorProfile.saved'));
        }
      } catch (err) {
        fail(err);
      }
    });

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!AVATAR_TYPES.includes(file.type)) return setError(t('errors.UNSUPPORTED_FILE_TYPE'));
    if (file.size > MAX_AVATAR_BYTES) return setError(t('errors.FILE_TOO_LARGE'));
    upload.mutate(file, {
      onSuccess: () => void message.success(t('tutorProfile.avatarSaved')),
      onError: fail,
    });
  };

  const busy = save.isPending || resubmit.isPending;
  const text = (m?: string) => (m ? (i18n.exists(m) ? t(m) : m) : undefined);

  return (
    <Card style={{ maxWidth: 720, margin: '0 auto' }}>
      <Typography.Title level={3}>{t('tutorProfile.title')}</Typography.Title>
      {rejected ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('tutorProfile.rejectedNote', { reason: profile.data.rejectionReason ?? '' })}
        />
      ) : null}
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}

      <Form layout="vertical" onFinish={() => void submit(false)()} noValidate>
        <Form.Item label={t('tutorProfile.avatar')} extra={t('tutorProfile.avatarHint')}>
          <Space>
            <Avatar size={72} src={profile.data.avatarUrl ?? undefined} alt={t('tutors.avatarAlt', { name: profile.data.fullName })}>
              {initialOf(profile.data.fullName)}
            </Avatar>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              data-testid="avatar-input"
              onChange={(e) => {
                onPickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button onClick={() => fileInput.current?.click()} loading={upload.isPending}>
              {t('tutorProfile.avatarUpload')}
            </Button>
          </Space>
        </Form.Item>

        <TextField control={control} name="fullName" label={t('tutorProfile.fullName')} autoComplete="name" serverError={fieldErrors.fullName} />

        <Controller
          control={control}
          name="subjectIds"
          render={({ field, fieldState }) => (
            <Form.Item
              label={t('tutorProfile.subjects')}
              htmlFor="field-subjectIds"
              validateStatus={fieldState.error ? 'error' : undefined}
              help={text(fieldState.error?.message)}
            >
              <Select
                {...field}
                id="field-subjectIds"
                mode="multiple"
                placeholder={t('tutorProfile.subjectsPlaceholder')}
                loading={subjects.isPending}
                options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
            </Form.Item>
          )}
        />

        <Controller
          control={control}
          name="experience"
          render={({ field, fieldState }) => (
            <Form.Item label={t('tutorProfile.experience')} htmlFor="field-experience" validateStatus={fieldState.error ? 'error' : undefined} help={text(fieldState.error?.message)}>
              <Input.TextArea {...field} id="field-experience" rows={3} />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name="bio"
          render={({ field, fieldState }) => (
            <Form.Item label={t('tutorProfile.bio')} htmlFor="field-bio" validateStatus={fieldState.error ? 'error' : undefined} help={text(fieldState.error?.message)}>
              <Input.TextArea {...field} id="field-bio" rows={5} />
            </Form.Item>
          )}
        />
        <Controller
          control={control}
          name="pricePerSessionVnd"
          render={({ field, fieldState }) => {
            const message_ = text(fieldState.error?.message) ?? fieldErrors.pricePerSessionVnd;
            return (
              <Form.Item
                label={t('tutorProfile.price', { minutes: config.data?.slotDurationMinutes ?? 60 })}
                htmlFor="field-pricePerSessionVnd"
                validateStatus={message_ ? 'error' : undefined}
                help={message_}
                extra={status === 'APPROVED' ? t('tutorProfile.priceNote') : undefined}
              >
                <InputNumber
                  {...field}
                  id="field-pricePerSessionVnd"
                  min={0}
                  step={10000}
                  precision={0}
                  addonAfter={t('tutorProfile.priceSuffix')}
                  style={{ width: 220 }}
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              </Form.Item>
            );
          }}
        />

        <Space>
          <Button type="primary" htmlType="submit" loading={busy && !rejected}>
            {t('tutorProfile.save')}
          </Button>
          {rejected ? (
            <Button type="primary" loading={busy} onClick={() => void submit(true)()}>
              {t('tutorProfile.saveResubmit')}
            </Button>
          ) : null}
        </Space>
      </Form>
    </Card>
  );
}
