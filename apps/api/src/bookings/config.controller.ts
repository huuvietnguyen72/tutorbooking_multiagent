import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV } from '../common/config';
import { Public } from '../common/decorators';
import type { Env } from '../config/env';

@Controller('config')
export class PublicConfigController {
  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  /** Business rules the UI displays; the server stays the only place that applies them. */
  @Public()
  @Get('public')
  get() {
    return {
      cancellationWindowHours: this.env.CANCELLATION_WINDOW_HOURS,
      holdMinutes: this.env.BOOKING_HOLD_MINUTES,
      slotDurationMinutes: this.env.SLOT_DURATION_MINUTES,
      minBookingLeadMinutes: this.env.MIN_BOOKING_LEAD_MINUTES,
      timezone: this.env.DISPLAY_TIMEZONE,
      mockGatewayEnabled: this.env.MOCK_GATEWAY_ENABLED,
    };
  }
}
