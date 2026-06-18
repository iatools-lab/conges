import { Module } from '@nestjs/common';
import { AdminAuditController } from './audit.controller';
import { PrismaService } from '../../../prisma/prisma.service';

@Module({ controllers: [AdminAuditController], providers: [PrismaService] })
export class AdminAuditModule {}
