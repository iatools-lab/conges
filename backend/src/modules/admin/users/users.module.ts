import { Module } from '@nestjs/common';
import { AdminUsersService } from './users.service';
import { AdminUsersController } from './users.controller';
import { PrismaService } from '../../../prisma/prisma.service';
import { RhEmployeesModule } from '../../rh/employees/employees.module';

@Module({
  imports: [RhEmployeesModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, PrismaService],
})
export class AdminUsersModule {}
