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
import {
  DecideRhPermissionDto,
  FindRhPermissionsQueryDto,
} from '../../shared/permissions/dto/permission-request.dto';
import { PermissionRequestsService } from '../../shared/permissions/permission-requests.service';

@Controller('rh/permissions')
export class RhPermissionsController {
  constructor(private readonly permissionsService: PermissionRequestsService) {}

  @Get()
  findAll(@Query() query: FindRhPermissionsQueryDto) {
    return this.permissionsService.findRh(query);
  }

  @Patch(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideRhPermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.decideRh(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }
}
