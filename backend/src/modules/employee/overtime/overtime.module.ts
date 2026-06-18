import { Module } from '@nestjs/common';
import { EmployeeOvertimeController } from './overtime.controller';
import { EmployeeOvertimeService } from './overtime.service';

@Module({
  controllers: [EmployeeOvertimeController],
  providers: [EmployeeOvertimeService],
})
export class EmployeeOvertimeModule {}
