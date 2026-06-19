import { Module } from '@nestjs/common';
import { AdminHolidaysService } from './holidays.service';
import { AdminHolidaysController } from './holidays.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AdminHolidaysController],
  providers: [AdminHolidaysService, PrismaService],
  exports: [AdminHolidaysService],
})
export class AdminHolidaysModule {}
