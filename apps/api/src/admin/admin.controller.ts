import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import { reasonSchema } from '../bookings/bookings.dto';
import { hideReviewSchema } from '../reviews/reviews.dto';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminTutorsService } from './admin-tutors.service';
import { AdminUsersService } from './admin-users.service';
import {
  adminCancelSchema,
  listAdminBookingsSchema,
  listAuditSchema,
  listTutorsSchema,
  listUsersSchema,
  tutorActionSchema,
  tutorDecisionSchema,
  userStatusSchema,
} from './admin.dto';

/** Whole controller is ADMIN-only (deny by default); every write below records an audit row. */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly tutors: AdminTutorsService,
    private readonly bookings: AdminBookingsService,
    private readonly overview: AdminOverviewService,
  ) {}

  @Get('stats')
  stats() {
    return this.overview.stats();
  }

  @Get('users')
  listUsers(@Query() query: unknown) {
    const q = parse(listUsersSchema, query);
    return this.users.list(q, q.page, q.pageSize);
  }

  @Patch('users/:userId/status')
  setUserStatus(@CurrentUser() admin: AuthUser, @Param('userId') userId: string, @Body() body: unknown) {
    const input = parse(userStatusSchema, body);
    return this.users.setStatus(admin.id, uuidParam(userId, 'userId'), input.status, input.reason);
  }

  @Get('tutors')
  listTutors(@Query() query: unknown) {
    const q = parse(listTutorsSchema, query);
    return this.tutors.list(q, q.page, q.pageSize);
  }

  @HttpCode(200)
  @Post('tutors/:tutorId/:action')
  decideTutor(
    @CurrentUser() admin: AuthUser,
    @Param('tutorId') tutorId: string,
    @Param('action') action: string,
    @Body() body: unknown,
  ) {
    const parsedAction = parse(tutorActionSchema, action); // unknown action -> 400 (A3)
    const input = parse(tutorDecisionSchema, body);
    return this.tutors.decide(admin.id, uuidParam(tutorId, 'tutorId'), parsedAction, input.reason);
  }

  @Get('bookings')
  listBookings(@Query() query: unknown) {
    const q = parse(listAdminBookingsSchema, query);
    return this.bookings.list(q, q.page, q.pageSize);
  }

  @Get('bookings/:bookingId')
  getBooking(@Param('bookingId') bookingId: string) {
    return this.bookings.get(uuidParam(bookingId, 'bookingId'));
  }

  @HttpCode(200)
  @Post('bookings/:bookingId/cancel')
  cancelBooking(@CurrentUser() admin: AuthUser, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const input = parse(adminCancelSchema, body);
    return this.bookings.cancel(admin.id, uuidParam(bookingId, 'bookingId'), input.reason, input.refund);
  }

  @HttpCode(200)
  @Post('payments/:paymentId/refund')
  refundPayment(@CurrentUser() admin: AuthUser, @Param('paymentId') paymentId: string, @Body() body: unknown) {
    return this.bookings.refund(admin.id, uuidParam(paymentId, 'paymentId'), parse(reasonSchema, body).reason);
  }

  @Patch('reviews/:reviewId')
  hideReview(@CurrentUser() admin: AuthUser, @Param('reviewId') reviewId: string, @Body() body: unknown) {
    return this.overview.hideReview(admin.id, uuidParam(reviewId, 'reviewId'), parse(hideReviewSchema, body).hidden);
  }

  @Get('audit-logs')
  auditLogs(@Query() query: unknown) {
    const q = parse(listAuditSchema, query);
    return this.overview.auditLogs(q, q.page, q.pageSize);
  }
}
