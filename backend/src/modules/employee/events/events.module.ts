import { Module } from '@nestjs/common';
import { SharedLeaveEntitlementsModule } from '../../shared/leave-entitlements/leave-entitlements.module';
import { EmployeeEventsController } from './events.controller';
import { EmployeeEventsService } from './events.service';

@Module({
  imports: [SharedLeaveEntitlementsModule],
  controllers: [EmployeeEventsController],
  providers: [EmployeeEventsService],
})
export class EmployeeEventsModule {}
