import { Body, Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { RhAlertsService } from './alerts.service';
import {
  UpdateRhAlertRuleDto,
  UpdateRhAlertStatusDto,
} from './dto/rh-alerts.dto';

@Controller('rh/alerts')
export class RhAlertsController {
  constructor(private readonly alertsService: RhAlertsService) {}

  @Get()
  findAll(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('year') year?: string,
  ) {
    return this.alertsService.findAll({
      severity,
      status,
      dateFrom,
      dateTo,
      year,
    });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateRhAlertStatusDto) {
    return this.alertsService.updateAlertStatus(id, dto);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateRhAlertRuleDto) {
    return this.alertsService.updateRule(id, dto);
  }
}
