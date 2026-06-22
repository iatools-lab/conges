import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedManager,
} from '../../../common/auth/authenticated-request';
import {
  DecideManagerOvertimeDto,
  FindManagerOvertimeQueryDto,
} from './dto/manager-overtime.dto';
import { ManagerOvertimeService } from './overtime.service';

@Controller('manager/overtime')
export class ManagerOvertimeController {
  constructor(private readonly overtimeService: ManagerOvertimeService) {}

  @Get()
  findAll(
    @Query() query: FindManagerOvertimeQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.findAll(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }

  @Patch(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideManagerOvertimeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.decide(
      id,
      withAuthenticatedManager(dto, requireAuthSession(req)),
    );
  }
}
