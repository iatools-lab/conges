import { Module } from '@nestjs/common';
import { ManagerCalendarModule } from './calendar/calendar.module';
import { ManagerConflictsModule } from './conflicts/conflicts.module';
import { ManagerDashboardModule } from './dashboard/dashboard.module';
import { ManagerHistoryModule } from './history/history.module';
import { ManagerPlanningModule } from './planning/planning.module';
import { ManagerRequestsModule } from './requests/requests.module';

@Module({
  imports: [
    ManagerDashboardModule,
    ManagerRequestsModule,
    ManagerConflictsModule,
    ManagerCalendarModule,
    ManagerPlanningModule,
    ManagerHistoryModule,
  ],
})
export class ManagerModule {}
