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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import {
  EmployeeLeaveRequestsService,
  type UploadedLeaveProof,
} from './leave-requests.service';

const LEAVE_PROOF_MAX_BYTES = 5 * 1024 * 1024;

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
  @UseInterceptors(
    FileInterceptor('proof', { limits: { fileSize: LEAVE_PROOF_MAX_BYTES } }),
  )
  create(
    @Body() dto: CreateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() proof?: UploadedLeaveProof,
  ) {
    return this.leaveRequestsService.create(
      withAuthenticatedUser(dto, requireAuthSession(req)),
      proof,
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
  @UseInterceptors(
    FileInterceptor('proof', { limits: { fileSize: LEAVE_PROOF_MAX_BYTES } }),
  )
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeLeaveRequestDto,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() proof?: UploadedLeaveProof,
  ) {
    return this.leaveRequestsService.update(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
      proof,
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
