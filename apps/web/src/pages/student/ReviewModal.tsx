import { Alert, Form, Input, Modal, Rate, message } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { errorText } from '../../api/errors';
import { useReviewBooking } from '../../api/hooks';
import type { Booking } from '../../api/types';

/** S-14: 1–5 stars required, comment optional (≤ 1000). One review per booking, no edits. */
export default function ReviewModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { t } = useTranslation();
  const review = useReviewBooking(booking.id);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setTouched(true);
    if (rating < 1) return;
    setError(null);
    const text = comment.trim();
    review.mutate(
      { rating, ...(text ? { comment: text } : {}) },
      {
        onSuccess: () => {
          void message.success(t('reviewModal.ok'));
          onClose();
        },
        onError: (err) => {
          setError(errorText(err));
          // Reviewed meanwhile / session state changed: the refetched `actions` and `review` settle the UI.
          if (err instanceof ApiError && ['ALREADY_REVIEWED', 'NOT_CONFIRMED', 'NOT_FINISHED'].includes(err.code)) onClose();
        },
      },
    );
  };

  return (
    <Modal
      open
      title={t('reviewModal.title', { name: booking.tutor.fullName })}
      onCancel={onClose}
      onOk={submit}
      okText={t('reviewModal.submit')}
      cancelText={t('reviewModal.later')}
      confirmLoading={review.isPending}
      destroyOnHidden
    >
      {error ? <Alert type="error" showIcon role="alert" message={error} style={{ marginBottom: 16 }} /> : null}
      <Form layout="vertical">
        <Form.Item
          label={t('reviewModal.rating')}
          required
          validateStatus={touched && rating < 1 ? 'error' : undefined}
          help={touched && rating < 1 ? t('reviewModal.ratingRequired') : undefined}
        >
          <Rate value={rating} onChange={setRating} aria-label={t('reviewModal.rating')} />
        </Form.Item>
        <Form.Item label={t('reviewModal.comment')} htmlFor="review-comment">
          <Input.TextArea
            id="review-comment"
            rows={4}
            maxLength={1000}
            showCount
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
