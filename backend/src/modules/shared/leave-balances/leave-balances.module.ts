import { Global, Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../leave-entitlements/leave-entitlements.module';
import { LeaveBalanceInitializerService } from './leave-balance-initializer.service';
import { LeaveBalanceSyncService } from './leave-balance-sync.service';

@Global()
@Module({
  imports: [SharedLeaveEntitlementsModule],
  providers: [LeaveBalanceSyncService, LeaveBalanceInitializerService],
  exports: [LeaveBalanceSyncService, LeaveBalanceInitializerService],
})
export class SharedLeaveBalancesModule {}
