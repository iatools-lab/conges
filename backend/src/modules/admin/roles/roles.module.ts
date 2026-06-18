import { Module } from '@nestjs/common';
import { AdminRolesService } from './roles.service';
import { AdminRolesController } from './roles.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AdminRolesController],
  providers: [AdminRolesService, PrismaService],
})
export class AdminRolesModule {}
