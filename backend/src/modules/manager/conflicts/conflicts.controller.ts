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
import { ManagerConflictsService } from './conflicts.service';
import {
  FindManagerConflictsQueryDto,
  UpdateManagerConflictDto,
} from './dto/manager-conflict.dto';

@Controller('manager/conflicts')
export class ManagerConflictsController {
  constructor(private readonly conflictsService: ManagerConflictsService) {}

  @Get()
  findAll(
    @Query() query: FindManagerConflictsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conflictsService.findAll(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateManagerConflictDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.conflictsService.updateStatus(
      id,
      withAuthenticatedManager(dto, requireAuthSession(req)),
    );
  }
}
