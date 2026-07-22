import { Module } from '@nestjs/common';
import { SharedLeaveBalancesModule } from '../../shared/leave-balances/leave-balances.module';
import { ManagerDashboardController } from './dashboard.controller';
import { ManagerDashboardService } from './dashboard.service';

@Module({
  imports: [SharedLeaveBalancesModule],
  controllers: [ManagerDashboardController],
  providers: [ManagerDashboardService],
})
export class ManagerDashboardModule {}
