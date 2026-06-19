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
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import {
  CreateEmployeeLeaveRequestDto,
  FindEmployeeLeaveRequestsQueryDto,
  UpdateEmployeeLeaveRequestDto,
} from './dto/employee-leave-request.dto';
import { EmployeeLeaveRequestsService } from './leave-requests.service';

@Controller('employee/leave-requests')
export class EmployeeLeaveRequestsController {
  constructor(
    private readonly leaveRequestsService: EmployeeLeaveRequestsService,
  ) {}

  @Get()
  findAll(
    @Query() query: FindEmployeeLeaveRequestsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.findAll(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Get('holidays')
  findHolidays() {
    return this.leaveRequestsService.findHolidays();
  }

  @Post()
  create(
    @Body() dto: CreateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.create(
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Post(':id/submit')
  submit(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.submit(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.update(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Delete(':id/permanent')
  remove(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.remove(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Delete(':id')
  cancel(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leaveRequestsService.cancel(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }
}
