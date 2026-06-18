import { Global, Module } from '@nestjs/common';
import { LeaveBalanceSyncService } from './leave-balance-sync.service';

@Global()
@Module({
  providers: [LeaveBalanceSyncService],
  exports: [LeaveBalanceSyncService],
})
export class SharedLeaveBalancesModule {}
