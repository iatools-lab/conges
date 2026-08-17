import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventType, LeaveCategory, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { LeaveBalanceInitializerService } from '../../shared/leave-balances/leave-balance-initializer.service';
import { getCurrentLeaveYear } from '../../../common/leave-year';
import {
  isPaidLeavePool,
  isSpecialLeavePool,
  SPECIAL_LEAVE_POOL_CAP_DAYS,
} from '../../shared/leave-balances/leave-balance-pools';

const POOL_PAYE_CODE = 'PAYE';
const POOL_SPECIAL_CODE = 'SPECIAL';
const MATERNITY_CODE = 'MAT';
const PAID_CONSUMPTION_ORDER = ['ANC', 'CP', 'ENF', 'PASSIF'] as const;

type BalanceDisplayRow = {
  id: string;
  source: string;
  code: string;
  category: LeaveCategory;
  acquired: number;
  taken: number;
  scheduled: number;
  remaining: number;
};

@Injectable()
export class EmployeeBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
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
    await this.leaveBalanceInitializer.initializeUserYear(userId, year);

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

    const rawPaidDetails = rows.filter((row) => this.isPaidPoolRow(row));
    const paidDetails = this.allocatePaidConsumption(rawPaidDetails);
    const specialDetails = rows.filter((row) => this.isSpecialPoolRow(row));
    const maternityRows = rows.filter((row) => this.isMaternityRow(row));

    // Use sumRowsRaw (no Math.max) for paid totals to allow negative balances
    const paidTotals = this.sumRowsRaw(rawPaidDetails);
    const rawSpecialTotals = this.sumRows(specialDetails);
    const specialTotals = {
      acquired: specialDetails.length ? SPECIAL_LEAVE_POOL_CAP_DAYS : 0,
      taken: rawSpecialTotals.taken,
      scheduled: rawSpecialTotals.scheduled,
      remaining: this.roundDays(
        (specialDetails.length ? SPECIAL_LEAVE_POOL_CAP_DAYS : 0) -
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
    const year = value ? Number(value) : getCurrentLeaveYear();

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }

  private allocatePaidConsumption(rows: BalanceDisplayRow[]) {
    const totalTaken = this.roundDays(
      rows.reduce((sum, row) => sum + row.taken, 0),
    );
    const totalScheduled = this.roundDays(
      rows.reduce((sum, row) => sum + row.scheduled, 0),
    );
    let remainingTaken = totalTaken;
    let remainingScheduled = totalScheduled;

    return [...rows]
      .sort(
        (left, right) =>
          this.paidConsumptionRank(left.code) -
          this.paidConsumptionRank(right.code),
      )
      .map((row) => {
        const capacity = Math.max(row.acquired, 0);
        const taken = Math.min(capacity, remainingTaken);
        remainingTaken = this.roundDays(remainingTaken - taken);
        const scheduled = Math.min(capacity - taken, remainingScheduled);
        remainingScheduled = this.roundDays(remainingScheduled - scheduled);

        return {
          ...row,
          taken: this.roundDays(taken),
          scheduled: this.roundDays(scheduled),
          remaining: this.roundDays(Math.max(capacity - taken - scheduled, 0)),
        };
      });
  }

  private paidConsumptionRank(code: string) {
    const normalized = code.trim().toUpperCase();
    const index = PAID_CONSUMPTION_ORDER.indexOf(
      normalized as (typeof PAID_CONSUMPTION_ORDER)[number],
    );

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  private isPaidPoolRow(row: { code: string; category: LeaveCategory }) {
    return isPaidLeavePool({
      leaveType: { code: row.code, category: row.category },
    });
  }

  private isSpecialPoolRow(row: { code: string; category: LeaveCategory }) {
    return isSpecialLeavePool({
      leaveType: { code: row.code, category: row.category },
    });
  }

  private isMaternityRow(row: { code: string; category: LeaveCategory }) {
    const normalizedCode = row.code.trim().toUpperCase();

    return (
      normalizedCode === MATERNITY_CODE ||
      row.category === LeaveCategory.CONGE_MATERNITE
    );
  }
}
