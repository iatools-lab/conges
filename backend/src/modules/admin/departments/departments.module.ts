import { Module } from '@nestjs/common';
import { AdminDepartmentsService } from './departments.service';
import { AdminDepartmentsController } from './departments.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({
  controllers: [AdminDepartmentsController],
  providers: [AdminDepartmentsService, PrismaService],
})
export class AdminDepartmentsModule {}
