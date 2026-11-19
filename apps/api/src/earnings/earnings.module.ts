import { Module } from '@nestjs/common';
import { EarningsSettlementService } from './earnings-settlement.service';
import { AdminEarningsController, TutorEarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';

@Module({
  controllers: [TutorEarningsController, AdminEarningsController],
  providers: [EarningsService, EarningsSettlementService],
})
export class EarningsModule {}
