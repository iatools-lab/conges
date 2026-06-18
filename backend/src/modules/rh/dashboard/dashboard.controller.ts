import { Controller, Get, Query } from '@nestjs/common';
import { RhDashboardService } from './dashboard.service';

@Controller('rh/dashboard')
export class RhDashboardController {
  constructor(private readonly dashboardService: RhDashboardService) {}

  @Get()
  findSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('year') year?: string,
  ) {
    return this.dashboardService.findSummary({ dateFrom, dateTo, year });
  }
}
