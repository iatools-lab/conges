import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { RhLeaveLiabilitiesController } from './leave-liabilities.controller';
import { RhLeaveLiabilitiesService } from './leave-liabilities.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [RhLeaveLiabilitiesController],
  providers: [RhLeaveLiabilitiesService],
})
export class RhLeaveLiabilitiesModule {}
