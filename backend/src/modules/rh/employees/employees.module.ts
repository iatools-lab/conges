import { Module } from '@nestjs/common';
import { RhEmployeesController } from './employees.controller';
import { RhEmployeesService } from './employees.service';

@Module({
  controllers: [RhEmployeesController],
  providers: [RhEmployeesService],
  exports: [RhEmployeesService],
})
export class RhEmployeesModule {}
