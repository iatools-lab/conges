import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SharedNotificationsModule } from '../shared/notifications/notifications.module';
import { AuthRateLimitGuard } from '../../common/guards/auth-rate-limit.guard';

@Module({
  imports: [PrismaModule, SharedNotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitGuard],
})
export class AuthModule {}
