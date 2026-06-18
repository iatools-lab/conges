import { Module } from '@nestjs/common';
import { LeaveEntitlementsService } from './leave-entitlements.service';

@Module({
  providers: [LeaveEntitlementsService],
  exports: [LeaveEntitlementsService],
})
export class SharedLeaveEntitlementsModule {}
