import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  LeaveEntitlementsService,
  MAX_PASSIVE_LEAVE_DAYS,
} from '../../shared/leave-entitlements/leave-entitlements.service';
import {
  ImportRhLeaveLiabilitiesDto,
  ImportRhLeaveLiabilityRowDto,
  UpdateRhLeaveLiabilityDto,
} from './dto/rh-leave-liability.dto';
import { getCurrentLeaveYear } from '../../../common/leave-year';

const PASSIVE_LEAVE_CODE = 'PASSIF';
const PASSIVE_LEAVE_YEARS = [2025, 2026, 2027] as const;

const passiveLeaveTypeSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  defaultDays: true,
} satisfies Prisma.LeaveTypeSelect;

const liabilityUserSelect = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  sexe: true,
  dateEmbauche: true,
  passifInitial: true,
  status: true,
  department: { select: { name: true } },
  balances: {
    where: {
      year: { in: PASSIVE_LEAVE_YEARS as unknown as number[] },
      leaveType: { code: PASSIVE_LEAVE_CODE },
    },
    select: {
      year: true,
      acquired: true,
      carryover: true,
      taken: true,
      scheduled: true,
    },
  },
} satisfies Prisma.UserSelect;

type PassiveLeaveType = Prisma.LeaveTypeGetPayload<{
  select: typeof passiveLeaveTypeSelect;
}>;
type LiabilityUser = Prisma.UserGetPayload<{
  select: typeof liabilityUserSelect;
}>;
type LiabilityResponse = ReturnType<RhLeaveLiabilitiesService['toResponse']>;
type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RhLeaveLiabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
  ) {}

  async findAll(yearValue?: string) {
    const year = this.parseYear(yearValue);
    const [leaveType, users] = await Promise.all([
      this.findPassiveLeaveType(this.prisma),
      this.prisma.user.findMany({
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        select: liabilityUserSelect,
      }),
    ]);
    const rows = users.map((user) => this.toResponse(user, leaveType));

    return {
      year,
      passiveYears: PASSIVE_LEAVE_YEARS,
      rows,
      totals: this.buildTotals(rows),
    };
  }

  async update(userId: string, dto: UpdateRhLeaveLiabilityDto) {
    const passifInitial = this.normalizePassiveDays(dto.passifInitial);

    return this.prisma.$transaction(async (transaction) => {
      await this.ensureEmployeeExists(transaction, userId);
      const leaveType = await this.ensurePassiveLeaveType(transaction);
      await transaction.user.update({
        where: { id: userId },
        data: { passifInitial },
      });
      await this.syncPassiveBalances(transaction, userId, leaveType);
      const user = await this.findLiabilityUser(transaction, userId);

      return this.toResponse(user, leaveType);
    });
  }

  async importRows(dto: ImportRhLeaveLiabilitiesDto) {
    if (!dto.rows.length) {
      throw new BadRequestException('Aucune ligne de passif à importer');
    }

    return this.prisma.$transaction(async (transaction) => {
      const leaveType = await this.ensurePassiveLeaveType(transaction);
      const rows: LiabilityResponse[] = [];

      for (const importRow of dto.rows) {
        const employee = await this.findEmployeeForImport(
          transaction,
          importRow,
        );
        const passifInitial = this.normalizePassiveDays(
          importRow.passifInitial,
        );
        await transaction.user.update({
          where: { id: employee.id },
          data: { passifInitial },
        });
        await this.syncPassiveBalances(transaction, employee.id, leaveType);
        rows.push(
          this.toResponse(
            await this.findLiabilityUser(transaction, employee.id),
            leaveType,
          ),
        );
      }

      return {
        imported: rows.length,
        rows,
      };
    });
  }

  private async findPassiveLeaveType(client: PrismaClientLike) {
    return client.leaveType.findUnique({
      where: { code: PASSIVE_LEAVE_CODE },
      select: passiveLeaveTypeSelect,
    });
  }

  private async ensurePassiveLeaveType(client: PrismaClientLike) {
    return client.leaveType.upsert({
      where: { code: PASSIVE_LEAVE_CODE },
      create: {
        code: PASSIVE_LEAVE_CODE,
        name: 'Passif congés',
        category: LeaveCategory.CONGE_PAYE,
        defaultDays: 0,
        requiresProof: false,
        paid: true,
        active: true,
        color: '#0F766E',
        description: 'Passif régularisé sur 2025, 2026 et 2027.',
      },
      update: {
        active: true,
        category: LeaveCategory.CONGE_PAYE,
      },
      select: passiveLeaveTypeSelect,
    });
  }

  private async syncPassiveBalances(
    client: PrismaClientLike,
    userId: string,
    leaveType: PassiveLeaveType,
  ) {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: {
        sexe: true,
        dateEmbauche: true,
        passifInitial: true,
      },
    });
    if (!user) throw new NotFoundException('Employé introuvable');

    for (const year of PASSIVE_LEAVE_YEARS) {
      const acquired = this.leaveEntitlements.getAcquiredDays({
        leaveType,
        user,
        year,
      });

      await client.leaveBalance.upsert({
        where: {
          userId_leaveTypeId_year: {
            userId,
            leaveTypeId: leaveType.id,
            year,
          },
        },
        create: {
          userId,
          leaveTypeId: leaveType.id,
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

  private async ensureEmployeeExists(client: PrismaClientLike, userId: string) {
    const employee = await client.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
  }

  private async findLiabilityUser(client: PrismaClientLike, userId: string) {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: liabilityUserSelect,
    });
    if (!user) throw new NotFoundException('Employé introuvable');

    return user;
  }

  private async findEmployeeForImport(
    client: PrismaClientLike,
    row: ImportRhLeaveLiabilityRowDto,
  ) {
    const employeeId = row.employeeId?.trim();
    const matricule = row.matricule?.trim();
    if (!employeeId && !matricule) {
      throw new BadRequestException('Chaque ligne doit contenir un matricule');
    }

    const employee = await client.user.findFirst({
      where: employeeId ? { id: employeeId } : { matricule },
      select: { id: true, matricule: true },
    });
    if (!employee) {
      throw new NotFoundException(
        `Employé introuvable: ${matricule ?? employeeId}`,
      );
    }

    return employee;
  }

  private toResponse(user: LiabilityUser, leaveType: PassiveLeaveType | null) {
    const balancesByYear = new Map(
      user.balances.map((balance) => [balance.year, balance]),
    );
    const years = PASSIVE_LEAVE_YEARS.map((year) => {
      const balance = balancesByYear.get(year);
      const expectedAllocation = this.getFallbackPassiveDays(
        user,
        leaveType,
        year,
      );
      const allocated = balance
        ? this.roundDays(expectedAllocation + balance.carryover)
        : expectedAllocation;
      const consumed = balance
        ? this.roundDays(balance.taken + balance.scheduled)
        : 0;

      return {
        year,
        allocated,
        consumed,
        remaining: this.roundDays(Math.max(allocated - consumed, 0)),
      };
    });
    const consumed = this.roundDays(
      years.reduce((sum, year) => sum + year.consumed, 0),
    );
    const remaining = this.roundDays(
      years.reduce((sum, year) => sum + year.remaining, 0),
    );
    const passifInitial = this.clampPassiveDays(user.passifInitial);
    const status = this.getStatus(passifInitial, consumed, remaining);

    return {
      id: user.id,
      employeeId: user.id,
      employeeName: `${user.prenom} ${user.nom}`.trim(),
      matricule: user.matricule,
      department: user.department?.name ?? 'Sans département',
      status: user.status,
      passifInitial,
      y2025: years[0].allocated,
      y2026: years[1].allocated,
      y2027: years[2].allocated,
      consumed,
      remaining,
      liabilityStatus: status.status,
      liabilityStatusLabel: status.label,
      years,
    };
  }

  private getFallbackPassiveDays(
    user: LiabilityUser,
    leaveType: PassiveLeaveType | null,
    year: number,
  ) {
    if (!leaveType) {
      return this.leaveEntitlements.getPassiveLeaveDays(
        user.passifInitial,
        year,
      );
    }

    return this.leaveEntitlements.getAcquiredDays({ leaveType, user, year });
  }

  private buildTotals(
    rows: ReturnType<RhLeaveLiabilitiesService['toResponse']>[],
  ) {
    return {
      employees: rows.length,
      employeesWithLiability: rows.filter((row) => row.remaining > 0).length,
      initial: this.roundDays(
        rows.reduce((sum, row) => sum + row.passifInitial, 0),
      ),
      allocated: this.roundDays(
        rows.reduce((sum, row) => sum + row.y2025 + row.y2026 + row.y2027, 0),
      ),
      consumed: this.roundDays(
        rows.reduce((sum, row) => sum + row.consumed, 0),
      ),
      remaining: this.roundDays(
        rows.reduce((sum, row) => sum + row.remaining, 0),
      ),
    };
  }

  private getStatus(
    passifInitial: number,
    consumed: number,
    remaining: number,
  ) {
    if (passifInitial <= 0) return { status: 'neutral', label: 'Sans passif' };
    if (remaining <= 0) return { status: 'valid', label: 'Soldé' };
    if (consumed > 0) return { status: 'pending', label: 'En apurement' };

    return { status: 'rejected', label: 'À apurer' };
  }

  private parseYear(value: string | undefined) {
    if (!value) return getCurrentLeaveYear();

    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private normalizePassiveDays(value: number) {
    const passiveDays = Number(value);
    if (!Number.isFinite(passiveDays)) {
      throw new BadRequestException('Passif initial invalide');
    }

    return this.clampPassiveDays(passiveDays);
  }

  private clampPassiveDays(value: number) {
    return Math.min(
      this.roundDays(Math.max(Number(value ?? 0), -MAX_PASSIVE_LEAVE_DAYS)),
      MAX_PASSIVE_LEAVE_DAYS,
    );
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
