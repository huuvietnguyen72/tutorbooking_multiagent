import { Module } from '@nestjs/common';
import { EarningsSettlementService } from './earnings-settlement.service';
import { AdminEarningsReadService } from './earnings-admin.service';
import { AdminEarningsController, AdminEarningsListController, TutorEarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';

@Module({
  controllers: [TutorEarningsController, AdminEarningsController, AdminEarningsListController],
  providers: [EarningsService, EarningsSettlementService, AdminEarningsReadService],
})
export class EarningsModule {}
