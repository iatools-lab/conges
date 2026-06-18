import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Controller('admin/audit')
export class AdminAuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Query('userId') userId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { rows };
  }
}
