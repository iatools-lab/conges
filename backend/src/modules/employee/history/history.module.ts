import { Module } from '@nestjs/common';
import { EmployeeHistoryController } from './history.controller';
import { EmployeeHistoryService } from './history.service';

@Module({
  controllers: [EmployeeHistoryController],
  providers: [EmployeeHistoryService],
})
export class EmployeeHistoryModule {}
