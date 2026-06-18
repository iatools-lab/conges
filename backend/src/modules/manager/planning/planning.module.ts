import { Module } from '@nestjs/common';
import { ManagerPlanningController } from './planning.controller';
import { ManagerPlanningService } from './planning.service';

@Module({
  controllers: [ManagerPlanningController],
  providers: [ManagerPlanningService],
})
export class ManagerPlanningModule {}
