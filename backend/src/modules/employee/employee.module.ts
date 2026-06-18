import { Module } from '@nestjs/common';
import { EmployeeBalancesModule } from './balances/balances.module';
import { EmployeeDashboardModule } from './dashboard/dashboard.module';
import { EmployeeEventsModule } from './events/events.module';
import { EmployeeHistoryModule } from './history/history.module';
import { EmployeeLeaveRequestsModule } from './leave-requests/leave-requests.module';
import { EmployeePlanningModule } from './planning/planning.module';

@Module({
  imports: [
    EmployeeDashboardModule,
    EmployeeBalancesModule,
    EmployeePlanningModule,
    EmployeeLeaveRequestsModule,
    EmployeeEventsModule,
    EmployeeHistoryModule,
  ],
})
export class EmployeeModule {}
