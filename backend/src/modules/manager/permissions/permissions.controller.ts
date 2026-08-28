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
  DecideManagerPermissionDto,
  FindManagerPermissionsQueryDto,
} from '../../shared/permissions/dto/permission-request.dto';
import { PermissionRequestsService } from '../../shared/permissions/permission-requests.service';

@Controller('manager/permissions')
export class ManagerPermissionsController {
  constructor(private readonly permissionsService: PermissionRequestsService) {}

  @Get()
  findAll(
    @Query() query: FindManagerPermissionsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.findManager(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }

  @Patch(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideManagerPermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.decideManager(
      id,
      withAuthenticatedManager(dto, requireAuthSession(req)),
    );
  }
}
