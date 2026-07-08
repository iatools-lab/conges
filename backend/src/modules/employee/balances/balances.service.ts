import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';

const POOL_PAYE_CODE = 'PAYE';
const POOL_SPECIAL_CODE = 'SPECIAL';
const MATERNITY_CODE = 'MAT';
const SPECIAL_POOL_CAP_DAYS = 12;
const PAID_SOURCE_CODES = new Set(['CP', 'ANC', 'ENF', 'PASSIF']);
const EXCLUDED_SPECIAL_CODES = new Set(['PASSIF', 'MAT', 'SS']);

@Injectable()
export class EmployeeBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findBalances(userId: string, yearValue?: string) {
    const year = this.parseYear(yearValue);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        sexe: true,
        dateEmbauche: true,
        passifInitial: true,
        children: { select: { dateNaissance: true } },
        events: {
          where: { type: EventType.BIRTH, processed: true },
          select: { type: true, eventDate: true, processed: true },
        },
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Employé introuvable');
    }

    // Ensure every active leave type has an initialized balance row with
    // correct acquired days. In production this read path must not overwrite
    // existing acquired days, because RH may have migrated or corrected them.
    const activeLeaveTypes = await this.prisma.leaveType.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        defaultDays: true,
      },
    });

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    await Promise.all(
      activeLeaveTypes.map(async (leaveType) => {
        const acquired = this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year,
        });

        const [approvedAgg, scheduledAgg, existingBalance] = await Promise.all([
          this.prisma.leaveRequest.aggregate({
            where: {
              ownerId: userId,
              leaveTypeId: leaveType.id,
              startDate: { gte: yearStart, lt: nextYearStart },
              status: LeaveRequestStatus.APPROVED,
              endDate: { lt: today },
            },
            _sum: { days: true },
          }),
          this.prisma.leaveRequest.aggregate({
            where: {
              ownerId: userId,
              leaveTypeId: leaveType.id,
              startDate: { gte: yearStart, lt: nextYearStart },
              OR: [
                {
                  status: LeaveRequestStatus.APPROVED,
                  endDate: { gte: today },
                },
                {
                  status: {
                    in: [
                      LeaveRequestStatus.PENDING,
                      LeaveRequestStatus.IN_REVIEW,
                    ],
                  },
                },
                {
                  status: LeaveRequestStatus.DRAFT,
                  submittedAt: null,
                },
              ],
            },
            _sum: { days: true },
          }),
          this.prisma.leaveBalance.findUnique({
            where: {
              userId_leaveTypeId_year: {
                userId,
                leaveTypeId: leaveType.id,
                year,
              },
            },
            select: { takenAdjustment: true },
          }),
        ]);
        const takenAdjustment = this.roundDays(
          existingBalance?.takenAdjustment ?? 0,
        );
        const taken = this.roundDays(
          (approvedAgg._sum.days ?? 0) + takenAdjustment,
        );

        await this.prisma.leaveBalance.upsert({
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
            taken,
            takenAdjustment,
            scheduled: this.roundDays(scheduledAgg._sum.days ?? 0),
          },
          update: {
            taken,
            scheduled: this.roundDays(scheduledAgg._sum.days ?? 0),
          },
        });
      }),
    );

    // Keep taken/scheduled aligned with requests after missing rows have been
    // created with their computed entitlement.
    await this.leaveBalanceSync.syncUserYear(userId, year);

    const balances = await this.prisma.leaveBalance.findMany({
      where: { userId, year },
      orderBy: [
        { leaveType: { category: 'asc' } },
        { leaveType: { code: 'asc' } },
      ],
      select: {
        id: true,
        acquired: true,
        taken: true,
        scheduled: true,
        carryover: true,
        leaveType: {
          select: {
            code: true,
            name: true,
            category: true,
            defaultDays: true,
          },
        },
      },
    });

    const rows = balances.map((balance) => {
      const code = balance.leaveType.code;
      const acquired = this.roundDays(balance.acquired + balance.carryover);
      const taken = this.roundDays(balance.taken);
      const scheduled = this.roundDays(balance.scheduled);
      const remaining = this.roundDays(acquired - taken - scheduled);

      return {
        id: balance.id,
        source: this.leaveEntitlements.getBalanceLabel(balance.leaveType, year),
        code,
        category: balance.leaveType.category,
        acquired,
        taken,
        scheduled,
        remaining,
      };
    });

    const paidDetails = rows.filter((row) => this.isPaidPoolRow(row));
    const specialDetails = rows.filter((row) => this.isSpecialPoolRow(row));
    const maternityRows = rows.filter((row) => this.isMaternityRow(row));

    // Use sumRowsRaw (no Math.max) for paid totals to allow negative balances
    const paidTotals = this.sumRowsRaw(paidDetails);
    const rawSpecialTotals = this.sumRows(specialDetails);
    const specialTotals = {
      acquired: specialDetails.length ? SPECIAL_POOL_CAP_DAYS : 0,
      taken: rawSpecialTotals.taken,
      scheduled: rawSpecialTotals.scheduled,
      remaining: this.roundDays(
        (specialDetails.length ? SPECIAL_POOL_CAP_DAYS : 0) -
          rawSpecialTotals.taken -
          rawSpecialTotals.scheduled,
      ),
    };

    const paidRows = [
      {
        id: POOL_PAYE_CODE,
        source: 'Congés payés (total annuel)',
        code: POOL_PAYE_CODE,
        category: LeaveCategory.CONGE_PAYE,
        ...paidTotals,
      },
    ];

    const specialRows = [
      {
        id: POOL_SPECIAL_CODE,
        source: 'Congés spéciaux (plafond 12 j)',
        code: POOL_SPECIAL_CODE,
        category: LeaveCategory.CONGE_SPECIAL,
        ...specialTotals,
      },
    ];

    return {
      year,
      rows,
      paidDetails,
      specialDetails,
      maternityRows,
      paidRows,
      specialRows,
      totals: paidTotals,
      specialTotals,
      maternityTotals: this.sumRows(maternityRows),
    };
  }

  /** Sum rows keeping negative values (no Math.max clamping). */
  private sumRowsRaw(
    rows: {
      acquired: number;
      taken: number;
      scheduled: number;
      remaining: number;
    }[],
  ) {
    return rows.reduce(
      (total, row) => ({
        acquired: this.roundDays(total.acquired + row.acquired),
        taken: this.roundDays(total.taken + row.taken),
        scheduled: this.roundDays(total.scheduled + row.scheduled),
        remaining: this.roundDays(total.remaining + row.remaining),
      }),
      { acquired: 0, taken: 0, scheduled: 0, remaining: 0 },
    );
  }

  private sumRows(
    rows: {
      acquired: number;
      taken: number;
      scheduled: number;
      remaining: number;
    }[],
  ) {
    return rows.reduce(
      (total, row) => ({
        acquired: this.roundDays(total.acquired + row.acquired),
        taken: this.roundDays(total.taken + row.taken),
        scheduled: this.roundDays(total.scheduled + row.scheduled),
        remaining: this.roundDays(total.remaining + row.remaining),
      }),
      { acquired: 0, taken: 0, scheduled: 0, remaining: 0 },
    );
  }

  private parseYear(value?: string) {
    const year = value ? Number(value) : new Date().getUTCFullYear();

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }

  private isPaidPoolRow(row: { code: string }) {
    return PAID_SOURCE_CODES.has(row.code.trim().toUpperCase());
  }

  private isSpecialPoolRow(row: { code: string; category: LeaveCategory }) {
    const normalizedCode = row.code.trim().toUpperCase();
    if (this.isPaidPoolRow(row)) return false;
    if (EXCLUDED_SPECIAL_CODES.has(normalizedCode)) return false;

    return (
      row.category === LeaveCategory.CONGE_SPECIAL ||
      row.category === LeaveCategory.CONGE_PATERNITE ||
      row.category === LeaveCategory.CONGE_MALADIE ||
      normalizedCode === 'SPE'
    );
  }

  private isMaternityRow(row: { code: string; category: LeaveCategory }) {
    const normalizedCode = row.code.trim().toUpperCase();

    return (
      normalizedCode === MATERNITY_CODE ||
      row.category === LeaveCategory.CONGE_MATERNITE
    );
  }
}
