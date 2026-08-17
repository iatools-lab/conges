import {
  Body,
  Controller,
  Delete,
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
import {
  UpdateRhPlannedDaysDto,
  UpdateRhTakenDaysDto,
  UpdateRhTotalDaysDto,
} from './dto/rh-balance-adjustment.dto';
import {
  CancelRhProcessedRequestDto,
  UpdateRhProcessedRequestDto,
} from './dto/rh-request-maintenance.dto';

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

  @Patch('balances/:userId/taken')
  updateTakenDays(
    @Param('userId') userId: string,
    @Body() dto: UpdateRhTakenDaysDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.updateTakenDays(
      userId,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Patch('balances/:userId/total')
  updateTotalDays(
    @Param('userId') userId: string,
    @Body() dto: UpdateRhTotalDaysDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.updateTotalDays(
      userId,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Patch('requests/:id/planned-days')
  updatePlannedDays(
    @Param('id') id: string,
    @Body() dto: UpdateRhPlannedDaysDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.updatePlannedDays(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Patch('requests/:id/processed')
  updateProcessedRequest(
    @Param('id') id: string,
    @Body() dto: UpdateRhProcessedRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.updateProcessedRequest(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Patch('requests/:id/cancel')
  cancelProcessedRequest(
    @Param('id') id: string,
    @Body() dto: CancelRhProcessedRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.cancelProcessedRequest(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }

  @Delete('requests/:id')
  deleteProcessedRequest(
    @Param('id') id: string,
    @Body() dto: CancelRhProcessedRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.globalViewService.deleteProcessedRequest(
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
