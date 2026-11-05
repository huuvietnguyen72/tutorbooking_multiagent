import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { MailModule } from './mail/mail.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { TutorsModule } from './tutors/tutors.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CommonModule, AuthModule, TutorsModule, BookingsModule, AdminModule, MailModule],
  controllers: [HealthController],
})
export class AppModule {}
