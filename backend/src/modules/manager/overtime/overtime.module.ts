import { Module } from '@nestjs/common';
import { ManagerOvertimeController } from './overtime.controller';
import { ManagerOvertimeService } from './overtime.service';

@Module({
  controllers: [ManagerOvertimeController],
  providers: [ManagerOvertimeService],
})
export class ManagerOvertimeModule {}
