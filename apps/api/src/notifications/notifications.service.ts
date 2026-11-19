import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { NotificationDto, toNotification } from './notifications.dto';

export interface NotificationPage {
  items: NotificationDto[];
  page: number;
  pageSize: number;
  total: number;
}

/** Every query is scoped to `userId`; a foreign id is indistinguishable from an unknown one (404). */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string, page: number, pageSize: number, unreadOnly: boolean): Promise<NotificationPage> {
    const where: Prisma.NotificationWhereInput = { userId, ...(unreadOnly ? { readAt: null } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows.map(toNotification), page, pageSize, total };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Idempotent: re-reading keeps the first `readAt`. */
  async markRead(userId: string, id: string): Promise<NotificationDto> {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: this.clock.now() } });
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound();
    return toNotification(row);
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: this.clock.now() },
    });
    return { updated: count };
  }
}
