import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminTutorsService } from './admin-tutors.service';
import { AdminUsersService } from './admin-users.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [BookingsModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AdminTutorsService, AdminBookingsService, AdminOverviewService],
})
export class AdminModule {}
