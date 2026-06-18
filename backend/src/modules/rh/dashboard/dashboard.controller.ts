import { Controller, Get } from '@nestjs/common';
import { RhDashboardService } from './dashboard.service';

@Controller('rh/dashboard')
export class RhDashboardController {
  constructor(private readonly dashboardService: RhDashboardService) {}

  @Get()
  findSummary() {
    return this.dashboardService.findSummary();
  }
}
