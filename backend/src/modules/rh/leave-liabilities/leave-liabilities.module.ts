import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { SharedNotificationsModule } from '../../shared/notifications/notifications.module';
import { RhLeaveLiabilitiesController } from './leave-liabilities.controller';
import { RhLeaveLiabilitiesService } from './leave-liabilities.service';

@Module({
  imports: [SharedLeaveEntitlementsModule, SharedNotificationsModule],
  controllers: [RhLeaveLiabilitiesController],
  providers: [RhLeaveLiabilitiesService],
})
export class RhLeaveLiabilitiesModule {}
