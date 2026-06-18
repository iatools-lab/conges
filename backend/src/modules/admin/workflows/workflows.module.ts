import { Module } from '@nestjs/common';
import { AdminWorkflowsService } from './workflows.service';
import { AdminWorkflowsController } from './workflows.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AdminWorkflowsController],
  providers: [AdminWorkflowsService, PrismaService],
})
export class AdminWorkflowsModule {}
