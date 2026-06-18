import { Module } from '@nestjs/common';
import { SharedDepartmentsModule } from './departments/departments.module';
import { SharedLeaveEntitlementsModule } from './leave-entitlements/leave-entitlements.module';
import { SharedLeaveBalancesModule } from './leave-balances/leave-balances.module';
import { SharedLeaveTypesModule } from './leave-types/leave-types.module';
import { SharedNotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    SharedDepartmentsModule,
    SharedLeaveBalancesModule,
    SharedLeaveEntitlementsModule,
    SharedLeaveTypesModule,
    SharedNotificationsModule,
  ],
  exports: [SharedLeaveBalancesModule, SharedLeaveEntitlementsModule],
})
export class SharedModule {}
