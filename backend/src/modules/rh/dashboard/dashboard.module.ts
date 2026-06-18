import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { RhDashboardController } from './dashboard.controller';
import { RhDashboardService } from './dashboard.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [RhDashboardController],
  providers: [RhDashboardService],
})
export class RhDashboardModule {}
