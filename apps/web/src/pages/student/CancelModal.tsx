import { Alert, Input, Modal, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { usePublicConfig, useStudentCancel } from '../../api/hooks';
import type { Booking } from '../../api/types';
import { formatVnd } from '../../lib/format';
import { formatSession } from '../../lib/time';

/** S-12: cancel a CONFIRMED booking (100% refund), or release an unpaid hold (S-07/S-11 cancel-hold button, no refund). Whether it is allowed comes from `actions.cancel`, not from local rules. */
export default function CancelModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: config } = usePublicConfig();
  const cancel = useStudentCancel(booking.id);
  const pending = booking.status === 'PENDING_PAYMENT';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const text = reason.trim();
    cancel.mutate(text || undefined, {
      onSuccess: () => {
        void message.success(pending ? t('payment.cancelled') : t('cancelModal.success', { amount: formatVnd(booking.priceVnd) }));
        onClose();
      },
      onError: (err) => {
        const code = err instanceof ApiError ? err.code : undefined;
        setError(code === 'WINDOW_PASSED' ? t('cancelModal.windowPassed', { hours: config?.cancellationWindowHours ?? '' }) : errorText(err));
        // Crossed the deadline or the state changed: close and let the refetched detail show the real state.
        if (code === 'WINDOW_PASSED' || code === 'NOT_CONFIRMED' || code === 'SESSION_STARTED') {
          void message.error(errorText(err));
          onClose();
        }
      },
    });
  };

  return (
    <Modal
      open
      title={pending ? t('payment.cancelTitle') : t('cancelModal.title')}
      onCancel={onClose}
      onOk={submit}
      okText={pending ? t('payment.cancelConfirm') : t('cancelModal.confirm')}
      okButtonProps={{ danger: true }}
      cancelText={pending ? t('payment.cancelKeep') : t('cancelModal.keep')}
      confirmLoading={cancel.isPending}
      destroyOnHidden
    >
      <p>
        <strong>{booking.tutor.fullName}</strong> · {formatSession(booking.startAt, booking.endAt)}
      </p>
      <p>{pending ? t('payment.cancelBody') : t('cancelModal.refundLine', { amount: formatVnd(booking.priceVnd) })}</p>
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 12 }} /> : null}
      <label htmlFor="student-cancel-reason">{t('cancelModal.reasonLabel')}</label>
      <Input.TextArea id="student-cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
