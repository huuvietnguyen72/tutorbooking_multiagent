import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { parse, uuidParam } from '../common/zod';
import { AdminEarningsReadService } from './earnings-admin.service';
import { EarningsSettlementService } from './earnings-settlement.service';
import { adminEarningsQuerySchema, earningsItemsQuerySchema, earningsQuerySchema, monthSchema, settlementBodySchema } from './earnings.dto';
import { EarningsService } from './earnings.service';

/** Read-only and scoped to the session's own id: there is no `tutorId` parameter to tamper with. */
@Roles('TUTOR')
@Controller('tutor/earnings')
export class TutorEarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.earnings.summary(user.id, parse(earningsQuerySchema, query).month);
  }

  @Get('items')
  items(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.earnings.items(user.id, parse(earningsItemsQuerySchema, query));
  }
}

@Roles('ADMIN')
@Controller('admin/earnings')
export class AdminEarningsListController {
  constructor(private readonly earnings: AdminEarningsReadService) {}

  /** Read-only: one row per tutor with counted sessions in the month. Settling stays per tutor (PUT below). */
  @Get()
  list(@Query() query: unknown) {
    return this.earnings.list(parse(adminEarningsQuerySchema, query));
  }
}

@Roles('ADMIN')
@Controller('admin/tutors')
export class AdminEarningsController {
  constructor(
    private readonly settlements: EarningsSettlementService,
    private readonly reads: AdminEarningsReadService,
  ) {}

  @Get(':tutorId/earnings/items')
  items(@Param('tutorId') tutorId: string, @Query() query: unknown) {
    return this.reads.items(uuidParam(tutorId, 'tutorId'), parse(earningsItemsQuerySchema, query));
  }

  /** Idempotent PUT: marks the tutor's finished month as settled; repeating it changes nothing. */
  @Put(':tutorId/earnings/:month/settlement')
  settle(
    @CurrentUser() admin: AuthUser,
    @Param('tutorId') tutorId: string,
    @Param('month') month: string,
    @Body() body: unknown,
  ) {
    parse(settlementBodySchema, body);
    return this.settlements.settleMonth(admin.id, uuidParam(tutorId, 'tutorId'), parse(monthSchema, month));
  }
}
