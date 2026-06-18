import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedManager,
} from '../../../common/auth/authenticated-request';
import { FindManagerCalendarQueryDto } from './dto/manager-calendar.dto';
import { ManagerCalendarService } from './calendar.service';

@Controller('manager/calendar')
export class ManagerCalendarController {
  constructor(private readonly calendarService: ManagerCalendarService) {}

  @Get()
  findMonth(
    @Query() query: FindManagerCalendarQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.calendarService.findMonth(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }
}
