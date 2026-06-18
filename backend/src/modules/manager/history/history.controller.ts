import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedManager,
} from '../../../common/auth/authenticated-request';
import { FindManagerHistoryQueryDto } from './dto/manager-history.dto';
import { ManagerHistoryService } from './history.service';

@Controller('manager/history')
export class ManagerHistoryController {
  constructor(private readonly historyService: ManagerHistoryService) {}

  @Get()
  findAll(
    @Query() query: FindManagerHistoryQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.historyService.findAll(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }
}
