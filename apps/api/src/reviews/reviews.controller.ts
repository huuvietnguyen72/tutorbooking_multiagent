import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import { listBookingsSchema } from '../bookings/bookings.dto';
import { ReviewsService } from './reviews.service';

const pageSchema = listBookingsSchema.pick({ page: true, pageSize: true });

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get('tutors/:tutorId/reviews')
  listPublic(@Param('tutorId') tutorId: string, @Query() query: unknown) {
    const q = parse(pageSchema, query);
    return this.reviews.listPublic(uuidParam(tutorId, 'tutorId'), q.page, q.pageSize);
  }

  @Roles('TUTOR')
  @Get('tutor/reviews')
  listMine(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const q = parse(pageSchema, query);
    return this.reviews.listMine(user.id, q.page, q.pageSize);
  }
}
