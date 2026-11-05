import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, RateLimit, Roles } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import {
  createBookingSchema,
  idempotencyKeySchema,
  listBookingsSchema,
  reasonSchema,
  studentCancelSchema,
  StudentBookingDto,
  TutorBookingDto,
} from './bookings.dto';
import { BookingsService, CheckoutDto, Page } from './bookings.service';

const MINUTE = 60_000;

@Roles('STUDENT')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @RateLimit({ name: 'create-booking', limit: 10, ttlMs: MINUTE, key: (req) => `user:${req.user?.id ?? req.ip}` })
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
  ): Promise<CheckoutDto> {
    const input = parse(createBookingSchema, body);
    if (key !== undefined && !idempotencyKeySchema.safeParse(key).success) {
      throw AppError.validation([{ field: 'Idempotency-Key', code: 'invalid_format' }]);
    }
    return this.bookings.create(user.id, input.slotId, key);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<Page<StudentBookingDto>> {
    const q = parse(listBookingsSchema, query);
    return this.bookings.list(user.id, q.scope, q.page, q.pageSize);
  }

  @Get(':bookingId')
  get(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string): Promise<StudentBookingDto> {
    return this.bookings.get(user.id, uuidParam(bookingId, 'bookingId'));
  }

  @HttpCode(200)
  @Post(':bookingId/checkout')
  checkout(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string): Promise<CheckoutDto> {
    return this.bookings.resumeCheckout(user.id, uuidParam(bookingId, 'bookingId'));
  }

  @HttpCode(200)
  @Post(':bookingId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<StudentBookingDto> {
    const input = parse(studentCancelSchema, body);
    return this.bookings.cancel(user.id, uuidParam(bookingId, 'bookingId'), input.reason ?? null);
  }
}

@Roles('TUTOR')
@Controller('tutor/bookings')
export class TutorBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<Page<TutorBookingDto>> {
    const q = parse(listBookingsSchema, query);
    return this.bookings.listForTutor(user.id, q.scope, q.page, q.pageSize);
  }

  @Get(':bookingId')
  get(@CurrentUser() user: AuthUser, @Param('bookingId') bookingId: string): Promise<TutorBookingDto> {
    return this.bookings.getForTutor(user.id, uuidParam(bookingId, 'bookingId'));
  }

  @HttpCode(200)
  @Post(':bookingId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('bookingId') bookingId: string,
    @Body() body: unknown,
  ): Promise<TutorBookingDto> {
    return this.bookings.cancelByTutor(user.id, uuidParam(bookingId, 'bookingId'), parse(reasonSchema, body).reason);
  }
}
