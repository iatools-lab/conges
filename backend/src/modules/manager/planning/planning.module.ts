import { Module } from '@nestjs/common';
import { SharedLeaveBalancesModule } from '../../shared/leave-balances/leave-balances.module';
import { ManagerPlanningController } from './planning.controller';
import { ManagerPlanningService } from './planning.service';

@Module({
  imports: [SharedLeaveBalancesModule],
  controllers: [ManagerPlanningController],
  providers: [ManagerPlanningService],
})
export class ManagerPlanningModule {}
