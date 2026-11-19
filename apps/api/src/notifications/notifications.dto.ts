import type { Notification } from '@prisma/client';
import { z } from 'zod';

const intParam = z.coerce.number().int();

export const listNotificationsSchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  page: intParam.min(1).max(100_000).default(1),
  pageSize: intParam.min(1).max(100).default(20),
});

export interface NotificationDto {
  id: string;
  type: Notification['type'];
  title: string;
  body: string;
  bookingId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export const toNotification = (row: Notification): NotificationDto => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  bookingId: row.bookingId,
  isRead: row.readAt !== null,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
