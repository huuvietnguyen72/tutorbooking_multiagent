import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';

export interface HealthResponse {
  status: 'ok';
}

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
