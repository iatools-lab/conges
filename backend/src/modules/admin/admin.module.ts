import { Module } from '@nestjs/common';
import { AdminDepartmentsModule } from './departments/departments.module';
import { AdminHolidaysModule } from './holidays/holidays.module';
import { AdminLogsModule } from './logs/logs.module';
import { AdminRolesModule } from './roles/roles.module';
import { AdminSettingsModule } from './settings/settings.module';
import { AdminUsersModule } from './users/users.module';
import { AdminWorkflowsModule } from './workflows/workflows.module';
import { AdminAuditModule } from './audit/audit.module';

@Module({
  imports: [
    AdminUsersModule,
    AdminRolesModule,
    AdminDepartmentsModule,
    AdminWorkflowsModule,
    AdminHolidaysModule,
    AdminSettingsModule,
    AdminLogsModule,
    AdminAuditModule,
  ],
})
export class AdminModule {}
