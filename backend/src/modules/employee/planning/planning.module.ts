import { Module } from '@nestjs/common';
import { EmployeePlanningController } from './planning.controller';
import { EmployeePlanningService } from './planning.service';

@Module({
  controllers: [EmployeePlanningController],
  providers: [EmployeePlanningService],
})
export class EmployeePlanningModule {}
