import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import type { Booking } from '../../api/types';

export function BookingStatusTag({ status }: { status: Booking['status'] }) {
  const { t } = useTranslation();
  const color = status === 'CONFIRMED' ? 'green' : status === 'PENDING_PAYMENT' ? 'gold' : status === 'EXPIRED' ? 'default' : 'red';
  return <Tag color={color}>{t(`myBookings.status.${status}`)}</Tag>;
}

export const isNotFound = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND');
