import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { EmployeeBalancesController } from './balances.controller';
import { EmployeeBalancesService } from './balances.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [EmployeeBalancesController],
  providers: [EmployeeBalancesService],
})
export class EmployeeBalancesModule {}
