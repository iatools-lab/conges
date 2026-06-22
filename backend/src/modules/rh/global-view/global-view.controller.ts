import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedRh,
} from '../../../common/auth/authenticated-request';
import { RhGlobalViewService } from './global-view.service';
import { DecideRhRequestDto } from './dto/rh-request-decision.dto';
import { RemarkRhRequestDto } from './dto/rh-request-remark.dto';
import { ImportRhLeaveHistoryDto } from './dto/rh-leave-history-import.dto';

@Controller('rh/global-view')
export class RhGlobalViewController {
  constructor(private readonly globalViewService: RhGlobalViewService) {}

  @Get()
  findSummary(
    @Query('year') year?: string,
    @Query('department') department?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.globalViewService.findSummary({
      year,
      department,
      dateFrom,
      dateTo,
    });
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

  @Post('requests/import-history')
  importHistory(
    @Body() dto: ImportRhLeaveHistoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.importHistory(
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }
}
