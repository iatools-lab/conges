import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedManager,
} from '../../../common/auth/authenticated-request';
import { ManagerDashboardService } from './dashboard.service';
import { FindManagerDashboardQueryDto } from './dto/manager-dashboard.dto';

@Controller('manager/dashboard')
export class ManagerDashboardController {
  constructor(private readonly dashboardService: ManagerDashboardService) {}

  @Get()
  findSummary(
    @Query() query: FindManagerDashboardQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.dashboardService.findSummary(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }
}
