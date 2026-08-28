import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { SharedNotificationsModule } from '../../shared/notifications/notifications.module';
import { RhLeaveBalancesController } from './leave-balances.controller';
import { RhLeaveBalancesService } from './leave-balances.service';

@Module({
  imports: [SharedLeaveEntitlementsModule, SharedNotificationsModule],
  controllers: [RhLeaveBalancesController],
  providers: [RhLeaveBalancesService],
})
export class RhLeaveBalancesModule {}
