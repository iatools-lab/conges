import { Module } from '@nestjs/common';
import { RhAlertsController } from './alerts.controller';
import { RhAlertsService } from './alerts.service';

@Module({
  controllers: [RhAlertsController],
  providers: [RhAlertsService],
})
export class RhAlertsModule {}
