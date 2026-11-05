import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Form, Input, Modal } from 'antd';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { errorText } from '../api/errors';

interface Props {
  title: string;
  okText: string;
  /** Message shown above the field (consequences of the action). */
  warning?: ReactNode;
  /** The reason is mandatory for rejections, cancellations and refunds; optional for the rest. */
  required?: boolean;
  danger?: boolean;
  /** Extra form controls rendered below the reason field. */
  children?: ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

/** Confirmation dialog collecting a reason (≤ 500 chars) for an admin action; shows the API error inline. */
export function ReasonModal({ title, okText, warning, required = true, danger, children, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const schema = z.object({
    reason: required
      ? z.string().trim().min(1, 'validation.reasonRequiredGeneric').max(500, 'validation.reasonMax')
      : z.string().trim().max(500, 'validation.reasonMax'),
  });
  const { control, handleSubmit } = useForm<{ reason: string }>({ resolver: zodResolver(schema), defaultValues: { reason: '' } });

  const submit = handleSubmit(async (values) => {
    setError(null);
    setPending(true);
    try {
      await onSubmit(values.reason);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  });

  return (
    <Modal
      open
      title={title}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={okText}
      okButtonProps={{ danger }}
      cancelText={t('admin.close')}
      confirmLoading={pending}
      destroyOnHidden
    >
      {warning ? <Alert type="warning" showIcon message={warning} style={{ marginBottom: 16 }} /> : null}
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
      <Controller
        control={control}
        name="reason"
        render={({ field, fieldState }) => (
          <Form.Item
            label={`${t('admin.reason')}${required ? ' *' : ''}`}
            htmlFor="admin-reason"
            validateStatus={fieldState.error ? 'error' : undefined}
            help={fieldState.error ? t(fieldState.error.message as string) : undefined}
          >
            <Input.TextArea {...field} id="admin-reason" rows={3} maxLength={500} />
          </Form.Item>
        )}
      />
      {children}
    </Modal>
  );
}
