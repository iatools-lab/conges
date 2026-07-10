import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { SharedLeaveBalancesModule } from '../../shared/leave-balances/leave-balances.module';
import { EmployeeBalancesController } from './balances.controller';
import { EmployeeBalancesService } from './balances.service';

@Module({
  imports: [SharedLeaveEntitlementsModule, SharedLeaveBalancesModule],
  controllers: [EmployeeBalancesController],
  providers: [EmployeeBalancesService],
})
export class EmployeeBalancesModule {}
