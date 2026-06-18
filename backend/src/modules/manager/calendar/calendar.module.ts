import { Module } from '@nestjs/common';
import { ManagerCalendarController } from './calendar.controller';
import { ManagerCalendarService } from './calendar.service';

@Module({
  controllers: [ManagerCalendarController],
  providers: [ManagerCalendarService],
})
export class ManagerCalendarModule {}
