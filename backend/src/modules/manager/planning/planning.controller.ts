import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedManager,
} from '../../../common/auth/authenticated-request';
import { FindManagerPlanningQueryDto } from './dto/manager-planning.dto';
import { ManagerPlanningService } from './planning.service';

@Controller('manager/planning')
export class ManagerPlanningController {
  constructor(private readonly planningService: ManagerPlanningService) {}

  @Get()
  findYear(
    @Query() query: FindManagerPlanningQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.planningService.findYear(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }
}
