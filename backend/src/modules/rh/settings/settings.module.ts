import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { RhSettingsController } from './settings.controller';
import { RhSettingsService } from './settings.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [RhSettingsController],
  providers: [RhSettingsService],
})
export class RhSettingsModule {}
