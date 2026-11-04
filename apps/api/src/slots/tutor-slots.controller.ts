import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AppError } from '../common/app-error';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { parse } from '../common/zod';
import { uuidSchema } from '../tutors/tutors.dto';
import { createSlotsSchema, moveSlotSchema, rangeSchema, TutorSlotDto } from './slots.dto';
import { TutorSlotsService } from './tutor-slots.service';

/** Malformed ids are a 400 (D4); foreign or unknown ids are a 404 (ownership rule). */
const id = (value: string): string => {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw AppError.validation([{ field: 'id', code: 'invalid_uuid' }]); // D4
  return result.data;
};

@Roles('TUTOR')
@Controller('tutor/slots')
export class TutorSlotsController {
  constructor(private readonly slots: TutorSlotsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<TutorSlotDto[]> {
    const range = parse(rangeSchema, query);
    return this.slots.list(user.id, range.from, range.to);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<TutorSlotDto[]> {
    return this.slots.create(user.id, parse(createSlotsSchema, body).startTimes);
  }

  @Patch(':slotId')
  move(@CurrentUser() user: AuthUser, @Param('slotId') slotId: string, @Body() body: unknown): Promise<TutorSlotDto> {
    return this.slots.move(user.id, id(slotId), parse(moveSlotSchema, body).startAt);
  }

  @HttpCode(204)
  @Delete(':slotId')
  remove(@CurrentUser() user: AuthUser, @Param('slotId') slotId: string): Promise<void> {
    return this.slots.remove(user.id, id(slotId));
  }

  @HttpCode(200)
  @Post(':slotId/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('slotId') slotId: string): Promise<TutorSlotDto> {
    return this.slots.reopen(user.id, id(slotId));
  }
}
