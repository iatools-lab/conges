import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import { FindEmployeeHistoryQueryDto } from './dto/employee-history.dto';
import { EmployeeHistoryService } from './history.service';

@Controller('employee/history')
export class EmployeeHistoryController {
  constructor(private readonly historyService: EmployeeHistoryService) {}

  @Get()
  findAll(
    @Query() query: FindEmployeeHistoryQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.findAll(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }
}
