import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
} from '../../../common/auth/authenticated-request';
import { RhExportsService } from './exports.service';
import { GenerateRhExportDto } from './dto/rh-export.dto';

@Controller('rh/exports')
export class RhExportsController {
  constructor(private readonly exportsService: RhExportsService) {}

  @Get()
  findSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.exportsService.findSummary({ dateFrom, dateTo });
  }

  @Post(':templateId/generate')
  generate(
    @Param('templateId') templateId: string,
    @Body() dto: GenerateRhExportDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const session = requireAuthSession(req);
    return this.exportsService.generate(templateId, {
      ...dto,
      actorEmail: session.email,
      actorName: undefined,
    });
  }
}
