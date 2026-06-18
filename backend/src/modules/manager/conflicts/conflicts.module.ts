import { Module } from '@nestjs/common';
import { ManagerConflictsController } from './conflicts.controller';
import { ManagerConflictsService } from './conflicts.service';

@Module({
  controllers: [ManagerConflictsController],
  providers: [ManagerConflictsService],
})
export class ManagerConflictsModule {}
