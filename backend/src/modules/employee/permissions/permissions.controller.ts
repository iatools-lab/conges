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
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import {
  CancelEmployeePermissionDto,
  CreateEmployeePermissionDto,
  FindEmployeePermissionsQueryDto,
  UpdateEmployeePermissionDto,
} from '../../shared/permissions/dto/permission-request.dto';
import { PermissionRequestsService } from '../../shared/permissions/permission-requests.service';

@Controller('employee/permissions')
export class EmployeePermissionsController {
  constructor(private readonly permissionsService: PermissionRequestsService) {}

  @Get()
  findAll(
    @Query() query: FindEmployeePermissionsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.findEmployee(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Post()
  create(
    @Body() dto: CreateEmployeePermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.createEmployee(
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeePermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.updateEmployee(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelEmployeePermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.cancelEmployee(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }
}
