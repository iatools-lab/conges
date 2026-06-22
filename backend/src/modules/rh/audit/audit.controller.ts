import { Controller, Get, Query } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { fieldDateWhere, resolveDateRange } from '../../../common/date-range';

@Controller('rh/audit')
export class RhAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('search') search?: string,
    @Query('action') action?: string,
    @Query('limit') limitRaw?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const limit = this.normalizeLimit(limitRaw);
    const normalizedSearch = search?.trim();
    const normalizedAction = this.normalizeAction(action);
    const range = resolveDateRange(
      { dateFrom, dateTo },
      { defaultMode: 'all' },
    );
    const createdAt = fieldDateWhere(range);

    const where: Prisma.AuditLogWhereInput = {
      ...(normalizedAction ? { action: normalizedAction } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(normalizedSearch
        ? {
            OR: [
              { entity: { contains: normalizedSearch, mode: 'insensitive' } },
              { entityId: { contains: normalizedSearch, mode: 'insensitive' } },
              {
                user: {
                  nom: { contains: normalizedSearch, mode: 'insensitive' },
                },
              },
              {
                user: {
                  prenom: { contains: normalizedSearch, mode: 'insensitive' },
                },
              },
              {
                user: {
                  email: { contains: normalizedSearch, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        userId: true,
        user: {
          select: {
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
    });

    return { dateFrom: range.dateFromIso, dateTo: range.dateToIso, rows };
  }

  private normalizeAction(value?: string): AuditAction | undefined {
    if (!value) return undefined;
    const candidate = value.trim().toUpperCase();
    return (Object.values(AuditAction) as string[]).includes(candidate)
      ? (candidate as AuditAction)
      : undefined;
  }

  private normalizeLimit(value?: string): number {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 200;
    if (parsed > 500) return 500;
    return parsed;
  }
}
