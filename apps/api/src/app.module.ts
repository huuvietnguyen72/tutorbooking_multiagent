import { Module } from '@nestjs/common';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { TutorsModule } from './tutors/tutors.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CommonModule, AuthModule, TutorsModule, BookingsModule],
  controllers: [HealthController],
})
export class AppModule {}
