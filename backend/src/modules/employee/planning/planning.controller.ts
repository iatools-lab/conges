import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import { FindEmployeePlanningQueryDto } from './dto/employee-planning.dto';
import { EmployeePlanningService } from './planning.service';

@Controller('employee/planning')
export class EmployeePlanningController {
  constructor(private readonly planningService: EmployeePlanningService) {}

  @Get('department')
  findDepartmentYear(
    @Query() query: FindEmployeePlanningQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.planningService.findDepartmentYear(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Get()
  findYear(
    @Query() query: FindEmployeePlanningQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.planningService.findYear(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }
}
