import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { RhLeaveBalancesController } from './leave-balances.controller';
import { RhLeaveBalancesService } from './leave-balances.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [RhLeaveBalancesController],
  providers: [RhLeaveBalancesService],
})
export class RhLeaveBalancesModule {}
