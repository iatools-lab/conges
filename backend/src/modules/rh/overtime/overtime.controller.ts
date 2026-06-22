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
  withAuthenticatedRh,
} from '../../../common/auth/authenticated-request';
import { RhOvertimeService } from './overtime.service';
import {
  DecideRhOvertimeDto,
  FindRhOvertimeQueryDto,
} from './dto/rh-overtime.dto';

@Controller('rh/overtime')
export class RhOvertimeController {
  constructor(private readonly overtimeService: RhOvertimeService) {}

  @Get()
  findAll(@Query() query: FindRhOvertimeQueryDto) {
    return this.overtimeService.findAll(query);
  }

  @Patch(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideRhOvertimeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.decide(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }
}
