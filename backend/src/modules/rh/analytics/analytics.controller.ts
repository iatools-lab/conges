import { Controller, Get, Query } from '@nestjs/common';
import { RhAnalyticsService } from './analytics.service';

@Controller('rh/analytics')
export class RhAnalyticsController {
  constructor(private readonly analyticsService: RhAnalyticsService) {}

  @Get()
  findSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('year') year?: string,
    @Query('absenceThreshold') absenceThreshold?: string,
    @Query('pendingDays') pendingDays?: string,
    @Query('unplannedThreshold') unplannedThreshold?: string,
  ) {
    return this.analyticsService.findSummary({
      dateFrom,
      dateTo,
      year,
      absenceThreshold,
      pendingDays,
      unplannedThreshold,
    });
  }
}
