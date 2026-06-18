import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { EmployeeDashboardController } from './dashboard.controller';
import { EmployeeDashboardService } from './dashboard.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [EmployeeDashboardController],
  providers: [EmployeeDashboardService],
})
export class EmployeeDashboardModule {}
