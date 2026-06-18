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
  CancelEmployeeOvertimeDto,
  CreateEmployeeOvertimeDto,
  FindEmployeeOvertimeQueryDto,
  UpdateEmployeeOvertimeDto,
} from './dto/employee-overtime.dto';
import { EmployeeOvertimeService } from './overtime.service';

@Controller('employee/overtime')
export class EmployeeOvertimeController {
  constructor(private readonly overtimeService: EmployeeOvertimeService) {}

  @Get()
  findAll(
    @Query() query: FindEmployeeOvertimeQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.findAll(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Post()
  create(
    @Body() dto: CreateEmployeeOvertimeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.create(
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeOvertimeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.update(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelEmployeeOvertimeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.overtimeService.cancel(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }
}
