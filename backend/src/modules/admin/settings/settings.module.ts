import { Module } from '@nestjs/common';
import { AdminSettingsService } from './settings.service';
import { AdminSettingsController } from './settings.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsService, PrismaService],
})
export class AdminSettingsModule {}
