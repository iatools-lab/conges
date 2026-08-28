import { Module } from '@nestjs/common';
import { RhAlertsModule } from './alerts/alerts.module';
import { RhAnalyticsModule } from './analytics/analytics.module';
import { RhAuditModule } from './audit/audit.module';
import { RhChildrenModule } from './children/children.module';
import { RhDashboardModule } from './dashboard/dashboard.module';
import { RhEmployeesModule } from './employees/employees.module';
import { RhExportsModule } from './exports/exports.module';
import { RhGlobalViewModule } from './global-view/global-view.module';
import { RhHolidaysModule } from './holidays/holidays.module';
import { RhHierarchyModule } from './hierarchy/hierarchy.module';
import { RhLeaveBalancesModule } from './leave-balances/leave-balances.module';
import { RhLeaveLiabilitiesModule } from './leave-liabilities/leave-liabilities.module';
import { RhPermissionsModule } from './permissions/permissions.module';
import { RhSettingsModule } from './settings/settings.module';
import { RhSpecialLeavesModule } from './special-leaves/special-leaves.module';

@Module({
  imports: [
    RhDashboardModule,
    RhAnalyticsModule,
    RhGlobalViewModule,
    RhHolidaysModule,
    RhHierarchyModule,
    RhAlertsModule,
    RhEmployeesModule,
    RhChildrenModule,
    RhSpecialLeavesModule,
    RhLeaveBalancesModule,
    RhLeaveLiabilitiesModule,
    RhPermissionsModule,
    RhExportsModule,
    RhAuditModule,
    RhSettingsModule,
  ],
})
export class RhModule {}
