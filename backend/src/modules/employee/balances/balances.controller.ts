import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
} from '../../../common/auth/authenticated-request';
import { EmployeeBalancesService } from './balances.service';

@Controller('employee/balances')
export class EmployeeBalancesController {
  constructor(private readonly balancesService: EmployeeBalancesService) {}

  @Get(':userId')
  findBalances(@Query('year') year: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.balancesService.findBalances(requireAuthSession(req).sub, year);
  }
}
