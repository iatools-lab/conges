import { Controller, Get, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
} from '../../../common/auth/authenticated-request';
import { EmployeeDashboardService } from './dashboard.service';

@Controller('employee/dashboard')
export class EmployeeDashboardController {
  constructor(private readonly dashboardService: EmployeeDashboardService) {}

  @Get(':userId')
  findSummary(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.findSummary(requireAuthSession(req).sub);
  }
}
