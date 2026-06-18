import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedRh,
} from '../../../common/auth/authenticated-request';
import { RhGlobalViewService } from './global-view.service';
import { DecideRhRequestDto } from './dto/rh-request-decision.dto';
import { RemarkRhRequestDto } from './dto/rh-request-remark.dto';

@Controller('rh/global-view')
export class RhGlobalViewController {
  constructor(private readonly globalViewService: RhGlobalViewService) {}

  @Get()
  findSummary(
    @Query('year') year?: string,
    @Query('department') department?: string,
  ) {
    return this.globalViewService.findSummary({ year, department });
  }

  @Patch('requests/:id/decision')
  decideRequest(
    @Param('id') id: string,
    @Body() dto: DecideRhRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.decideRequest(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Patch('requests/:id/remark')
  remarkRequest(
    @Param('id') id: string,
    @Body() dto: RemarkRhRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.addRemark(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }
}
