import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedRh,
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateEmployeeEventDto,
  FindEmployeeEventsQueryDto,
  ReviewEmployeeEventDto,
} from './dto/employee-event.dto';
import {
  EmployeeEventsService,
  EVENT_PROOF_MAX_BYTES,
  type UploadedEventProof,
} from './events.service';

@Controller('employee/events')
export class EmployeeEventsController {
  constructor(private readonly eventsService: EmployeeEventsService) {}

  @Get()
  findAll(
    @Query() query: FindEmployeeEventsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.eventsService.findAll(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('proof', { limits: { fileSize: EVENT_PROOF_MAX_BYTES } }),
  )
  create(
    @Body() dto: CreateEmployeeEventDto,
    @Req() req: AuthenticatedRequest,
    @UploadedFile() proof?: UploadedEventProof,
  ) {
    return this.eventsService.create(
      withAuthenticatedUser(dto, requireAuthSession(req)),
      proof,
    );
  }

  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewEmployeeEventDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.eventsService.review(
      id,
      withAuthenticatedRh(dto, requireAuthSession(req)),
    );
  }
}
