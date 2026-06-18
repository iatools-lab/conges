import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { ManagerDashboardController } from './dashboard.controller';
import { ManagerDashboardService } from './dashboard.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [ManagerDashboardController],
  providers: [ManagerDashboardService],
})
export class ManagerDashboardModule {}
