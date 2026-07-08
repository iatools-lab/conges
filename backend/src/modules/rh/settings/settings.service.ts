import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventType, LeaveCategory, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceInitializerService } from '../../shared/leave-balances/leave-balance-initializer.service';
import {
  CreateRhLeaveTypeDto,
  InitializeRhBalancesDto,
  UpdateRhLeaveTypeDto,
} from './dto/rh-settings.dto';

const leaveTypeSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  defaultDays: true,
  requiresProof: true,
  paid: true,
  color: true,
  active: true,
  description: true,
  updatedAt: true,
} satisfies Prisma.LeaveTypeSelect;

const DEFAULT_LEAVE_TYPES = [
  {
    code: 'CP',
    name: 'Congés payés',
    category: LeaveCategory.CONGE_PAYE,
    defaultDays: 24,
    requiresProof: false,
    paid: true,
    color: '#2563EB',
    description: 'Droit annuel standard acquis en N-1 et disponible en N.',
  },
  {
    code: 'PASSIF',
    name: 'Passif congés',
    category: LeaveCategory.CONGE_PAYE,
    defaultDays: 0,
    requiresProof: false,
    paid: true,
    color: '#0F766E',
    description: 'Régularisation du solde historique sur 2025, 2026 et 2027.',
  },
  {
    code: 'ANC',
    name: 'Ancienneté',
    category: LeaveCategory.CONGE_PAYE,
    defaultDays: 0,
    requiresProof: false,
    paid: true,
    color: '#CA8A04',
    description: '3 jours supplémentaires par palier de 5 ans d’ancienneté.',
  },
  {
    code: 'ENF',
    name: 'Congé enfant',
    category: LeaveCategory.CONGE_PAYE,
    defaultDays: 2,
    requiresProof: true,
    paid: true,
    color: '#DB2777',
    description:
      '2 jours par an et par enfant de moins de 6 ans, après validation RH de la naissance.',
  },

  {
    code: 'SPE',
    name: 'Congé spécial',
    category: LeaveCategory.CONGE_SPECIAL,
    defaultDays: 12,
    requiresProof: true,
    paid: true,
    color: '#EA580C',
    description:
      'Quota annuel séparé de 12 jours, non déduit des congés payés.',
  },
  {
    code: 'MAT',
    name: 'Congé maternité',
    category: LeaveCategory.CONGE_MATERNITE,
    defaultDays: 90,
    requiresProof: true,
    paid: true,
    color: '#DB2777',
    description: 'Congé maternité de 90 jours ouvrables (prise ponctuelle).',
  },
  {
    code: 'PAT',
    name: 'Congé paternité',
    category: LeaveCategory.CONGE_PATERNITE,
    defaultDays: 3,
    requiresProof: true,
    paid: true,
    color: '#7C3AED',
    description:
      '3 jours acquis une seule fois l’année de la naissance validée RH.',
  },
  {
    code: 'MAL',
    name: 'Congé maladie',
    category: LeaveCategory.CONGE_MALADIE,
    defaultDays: 0,
    requiresProof: true,
    paid: true,
    color: '#DC2626',
    description: 'Absence maladie avec justificatif médical.',
  },
  {
    code: 'SS',
    name: 'Congé sans solde',
    category: LeaveCategory.CONGE_SANS_SOLDE,
    defaultDays: 0,
    requiresProof: false,
    paid: false,
    color: '#64748B',
    description: 'Absence non rémunérée soumise à validation.',
  },
] satisfies Prisma.LeaveTypeCreateManyInput[];

@Injectable()
export class RhSettingsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultLeaveTypes();
    await this.initializeBalances({ year: new Date().getUTCFullYear() });
  }

  async findSettings(yearValue?: string) {
    const year = this.parseYear(yearValue);
    const [leaveTypes, balanceSummary] = await Promise.all([
      this.prisma.leaveType.findMany({
        orderBy: [{ active: 'desc' }, { code: 'asc' }],
        select: leaveTypeSelect,
      }),
      this.getBalanceSummary(year),
    ]);

    return { year, leaveTypes, balanceSummary };
  }

  async createDefaultLeaveTypes() {
    await this.ensureDefaultLeaveTypes();

    return this.prisma.leaveType.findMany({
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      select: leaveTypeSelect,
    });
  }

  private async ensureDefaultLeaveTypes() {
    const existing = await this.prisma.leaveType.findMany({
      select: { code: true },
    });
    const existingCodes = new Set(existing.map((leaveType) => leaveType.code));
    const missingDefaults = DEFAULT_LEAVE_TYPES.filter(
      (leaveType) => !existingCodes.has(leaveType.code),
    );

    if (!missingDefaults.length) return;

    await this.prisma.leaveType.createMany({
      data: missingDefaults.map((leaveType) => ({
        ...leaveType,
        active: true,
      })),
      skipDuplicates: true,
    });
  }

  async createLeaveType(dto: CreateRhLeaveTypeDto) {
    try {
      const created = await this.prisma.leaveType.create({
        data: this.toCreateData(dto),
        select: leaveTypeSelect,
      });

      await this.syncLeaveTypeBalances(created.id);
      return created;
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async updateLeaveType(id: string, dto: UpdateRhLeaveTypeDto) {
    await this.ensureLeaveTypeExists(id);

    try {
      const updated = await this.prisma.leaveType.update({
        where: { id },
        data: this.toUpdateData(dto),
        select: leaveTypeSelect,
      });

      await this.syncLeaveTypeBalances(updated.id);
      return updated;
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async deleteLeaveType(id: string) {
    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            balances: true,
            requests: true,
          },
        },
      },
    });

    if (!leaveType) throw new NotFoundException('Type de congé introuvable');

    const references = {
      balances: leaveType._count.balances,
      requests: leaveType._count.requests,
    };
    const hasReferences = references.balances > 0 || references.requests > 0;

    if (hasReferences) {
      const archivedLeaveType = await this.prisma.leaveType.update({
        where: { id },
        data: { active: false },
        select: leaveTypeSelect,
      });

      return {
        mode: 'archived' as const,
        leaveType: archivedLeaveType,
        references,
      };
    }

    const deletedLeaveType = await this.prisma.leaveType.delete({
      where: { id },
      select: leaveTypeSelect,
    });

    return {
      mode: 'deleted' as const,
      leaveType: deletedLeaveType,
      references,
    };
  }

  async initializeBalances(dto: InitializeRhBalancesDto) {
    const result = await this.leaveBalanceInitializer.initializeYear({
      year: dto.year,
      leaveTypeIds: dto.leaveTypeIds,
      refreshExisting: true,
    });

    if (!result.leaveTypes) {
      throw new BadRequestException('Aucun type de congé actif Ã  initialiser');
    }

    return {
      ...result,
      balanceSummary: await this.getBalanceSummary(dto.year),
    };
  }

  private async getBalanceSummary(year: number) {
    const [employees, leaveTypes, existingBalances] = await Promise.all([
      this.prisma.user.count({
        where: { status: { not: UserStatus.INACTIVE } },
      }),
      this.prisma.leaveType.count({ where: { active: true } }),
      this.prisma.leaveBalance.count({
        where: {
          year,
          user: { status: { not: UserStatus.INACTIVE } },
          leaveType: { active: true },
        },
      }),
    ]);
    const expectedBalances = employees * leaveTypes;

    return {
      year,
      employees,
      leaveTypes,
      expectedBalances,
      existingBalances,
      missingBalances: Math.max(expectedBalances - existingBalances, 0),
    };
  }

  private async syncLeaveTypeBalances(leaveTypeId: string) {
    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id: leaveTypeId },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        defaultDays: true,
      },
    });
    if (!leaveType) return;

    const [users, existingYears] = await Promise.all([
      this.prisma.user.findMany({
        where: { status: { not: UserStatus.INACTIVE } },
        select: {
          id: true,
          sexe: true,
          dateEmbauche: true,
          passifInitial: true,
          children: { select: { dateNaissance: true } },
          events: {
            where: { type: EventType.BIRTH, processed: true },
            select: { type: true, eventDate: true, processed: true },
          },
        },
      }),
      this.prisma.leaveBalance.findMany({
        where: { leaveTypeId },
        distinct: ['year'],
        select: { year: true },
      }),
    ]);

    const years = new Set<number>([
      new Date().getUTCFullYear(),
      ...existingYears.map((item) => item.year),
    ]);

    for (const user of users) {
      for (const year of years) {
        const acquired = this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year,
        });

        await this.prisma.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: user.id,
              leaveTypeId,
              year,
            },
          },
          create: {
            userId: user.id,
            leaveTypeId,
            year,
            acquired,
            carryover: 0,
            taken: 0,
            scheduled: 0,
          },
          update: { acquired },
        });
      }
    }
  }

  private toCreateData(dto: CreateRhLeaveTypeDto): Prisma.LeaveTypeCreateInput {
    return {
      code: this.normalizeCode(dto.code),
      name: dto.name.trim(),
      category: dto.category,
      defaultDays: dto.defaultDays,
      requiresProof: dto.requiresProof,
      paid: dto.paid,
      active: dto.active ?? true,
      color: dto.color?.trim() || null,
      description: dto.description?.trim() || null,
    };
  }

  private toUpdateData(dto: UpdateRhLeaveTypeDto): Prisma.LeaveTypeUpdateInput {
    const data: Prisma.LeaveTypeUpdateInput = {};

    if (dto.code !== undefined) data.code = this.normalizeCode(dto.code);
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.defaultDays !== undefined) data.defaultDays = dto.defaultDays;
    if (dto.requiresProof !== undefined) data.requiresProof = dto.requiresProof;
    if (dto.paid !== undefined) data.paid = dto.paid;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.color !== undefined) data.color = dto.color.trim() || null;
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }

    return data;
  }

  private normalizeCode(code: string) {
    const normalized = code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (!normalized) throw new BadRequestException('Code de congé invalide');

    return normalized;
  }

  private parseYear(value: string | undefined) {
    if (!value) return new Date().getUTCFullYear();

    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private async ensureLeaveTypeExists(id: string) {
    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!leaveType) throw new NotFoundException('Type de congé introuvable');
  }

  private handlePrismaError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Code de congé déjà utilisé');
    }
  }
}
