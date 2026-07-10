import { Module } from '@nestjs/common';
import { RhAnalyticsController } from './analytics.controller';
import { RhAnalyticsService } from './analytics.service';

@Module({
  controllers: [RhAnalyticsController],
  providers: [RhAnalyticsService],
})
export class RhAnalyticsModule {}
