import { Module } from '@nestjs/common';
import { AdminHolidaysModule } from '../../admin/holidays/holidays.module';
import { RhHolidaysController } from './holidays.controller';

@Module({
  imports: [AdminHolidaysModule],
  controllers: [RhHolidaysController],
})
export class RhHolidaysModule {}
