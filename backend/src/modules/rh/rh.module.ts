import { Module } from '@nestjs/common';
import { RhAlertsModule } from './alerts/alerts.module';
import { RhAuditModule } from './audit/audit.module';
import { RhChildrenModule } from './children/children.module';
import { RhDashboardModule } from './dashboard/dashboard.module';
import { RhEmployeesModule } from './employees/employees.module';
import { RhExportsModule } from './exports/exports.module';
import { RhGlobalViewModule } from './global-view/global-view.module';
import { RhLeaveBalancesModule } from './leave-balances/leave-balances.module';
import { RhLeaveLiabilitiesModule } from './leave-liabilities/leave-liabilities.module';
import { RhSettingsModule } from './settings/settings.module';
import { RhSpecialLeavesModule } from './special-leaves/special-leaves.module';

@Module({
  imports: [
    RhDashboardModule,
    RhGlobalViewModule,
    RhAlertsModule,
    RhEmployeesModule,
    RhChildrenModule,
    RhSpecialLeavesModule,
    RhLeaveBalancesModule,
    RhLeaveLiabilitiesModule,
    RhExportsModule,
    RhAuditModule,
    RhSettingsModule,
  ],
})
export class RhModule {}
