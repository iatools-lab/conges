import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { SharedNotificationsModule } from '../../shared/notifications/notifications.module';
import { RhSpecialLeavesController } from './special-leaves.controller';
import { RhSpecialLeavesService } from './special-leaves.service';

@Module({
  imports: [SharedLeaveEntitlementsModule, SharedNotificationsModule],
  controllers: [RhSpecialLeavesController],
  providers: [RhSpecialLeavesService],
})
export class RhSpecialLeavesModule {}
