import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import {
  requireAuthSession,
  type AuthenticatedRequest,
  withAuthenticatedUser,
} from '../../../common/auth/authenticated-request';
import {
  FindNotificationsQueryDto,
  NotificationOwnerDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(
    @Query() query: FindNotificationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.findAll(
      withAuthenticatedUser(query, requireAuthSession(req)),
    );
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @Body() dto: NotificationOwnerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.markRead(
      id,
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }

  @Patch('read-all')
  markAllRead(
    @Body() dto: NotificationOwnerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationsService.markAllRead(
      withAuthenticatedUser(dto, requireAuthSession(req)),
    );
  }
}
