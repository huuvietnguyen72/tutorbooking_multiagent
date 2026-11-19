import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import { listNotificationsSchema, NotificationDto } from './notifications.dto';
import { NotificationPage, NotificationsService } from './notifications.service';

@Roles('STUDENT', 'TUTOR')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<NotificationPage> {
    const q = parse(listNotificationsSchema, query);
    return this.notifications.list(user.id, q.page, q.pageSize, q.unreadOnly);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return this.notifications.unreadCount(user.id);
  }

  @HttpCode(200)
  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  @HttpCode(200)
  @Post(':notificationId/read')
  read(@CurrentUser() user: AuthUser, @Param('notificationId') id: string): Promise<NotificationDto> {
    return this.notifications.markRead(user.id, uuidParam(id, 'notificationId'));
  }
}
