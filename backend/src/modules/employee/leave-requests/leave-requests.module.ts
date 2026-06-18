import { Module } from '@nestjs/common';
import { EmployeeLeaveRequestsController } from './leave-requests.controller';
import { EmployeeLeaveRequestsService } from './leave-requests.service';

@Module({
  controllers: [EmployeeLeaveRequestsController],
  providers: [EmployeeLeaveRequestsService],
})
export class EmployeeLeaveRequestsModule {}
