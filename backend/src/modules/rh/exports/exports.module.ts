import { Module } from '@nestjs/common';
import { RhExportsController } from './exports.controller';
import { RhExportsService } from './exports.service';

@Module({
  controllers: [RhExportsController],
  providers: [RhExportsService],
})
export class RhExportsModule {}
