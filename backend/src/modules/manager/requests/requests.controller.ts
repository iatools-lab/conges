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
  DecideManagerRequestDto,
  FindManagerRequestsQueryDto,
} from './dto/manager-request.dto';
import { ManagerRequestsService } from './requests.service';

@Controller('manager/requests')
export class ManagerRequestsController {
  constructor(private readonly requestsService: ManagerRequestsService) {}

  @Get()
  findAll(
    @Query() query: FindManagerRequestsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requestsService.findAll(
      withAuthenticatedManager(query, requireAuthSession(req)),
    );
  }

  @Patch(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: DecideManagerRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requestsService.decide(
      id,
      withAuthenticatedManager(dto, requireAuthSession(req)),
    );
  }
}
