import { Module } from '@nestjs/common';
import { RhOvertimeController } from './overtime.controller';
import { RhOvertimeService } from './overtime.service';

@Module({
  controllers: [RhOvertimeController],
  providers: [RhOvertimeService],
})
export class RhOvertimeModule {}
