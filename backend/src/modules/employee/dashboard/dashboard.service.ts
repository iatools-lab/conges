import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

type BadgeTone =
  | 'valid'
  | 'pending'
  | 'rejected'
  | 'draft'
  | 'info'
  | 'neutral';

const PAID_POOL_CODES = new Set(['CP', 'ANC', 'ENF', 'PASSIF']);

const dashboardUserSelect = {
  id: true,
  nom: true,
  prenom: true,
  poste: true,
  sexe: true,
  dateEmbauche: true,
  passifInitial: true,
  status: true,
  children: { select: { dateNaissance: true } },
  events: {
    where: { type: EventType.BIRTH, processed: true },
    select: { type: true, eventDate: true, processed: true },
  },
} satisfies Prisma.UserSelect;

type DashboardUser = Prisma.UserGetPayload<{
  select: typeof dashboardUserSelect;
}>;

@Injectable()
export class EmployeeDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findSummary(
    userId: string,
    query: { dateFrom?: string; dateTo?: string; year?: string } = {},
  ) {
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;
    const today = new Date();

    const [
      user,
      specialLeaves,
      paidTaken,
      paidScheduled,
      nextAbsence,
      pendingRequests,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: dashboardUserSelect,
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          ownerId: userId,
          status: LeaveRequestStatus.APPROVED,
          ...overlapDateWhere(range),
          leaveType: {
            category: {
              in: [
                LeaveCategory.CONGE_SPECIAL,
                LeaveCategory.CONGE_PATERNITE,
                LeaveCategory.CONGE_MALADIE,
              ],
            },
          },
        },
        _sum: { days: true },
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          ownerId: userId,
          status: LeaveRequestStatus.APPROVED,
          ...overlapDateWhere(range),
          leaveType: { code: { in: Array.from(PAID_POOL_CODES) } },
        },
        _sum: { days: true },
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          ownerId: userId,
          ...overlapDateWhere(range),
          leaveType: { code: { in: Array.from(PAID_POOL_CODES) } },
          OR: [
            {
              status: {
                in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
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
      this.prisma.leaveRequest.findFirst({
        where: {
          ownerId: userId,
          status: LeaveRequestStatus.APPROVED,
          AND: [{ startDate: { gte: today } }, overlapDateWhere(range)],
        },
        orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
        select: {
          id: true,
          reference: true,
          startDate: true,
          endDate: true,
          days: true,
          status: true,
          leaveType: { select: { code: true, name: true } },
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          ownerId: userId,
          status: {
            in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
          },
        },
      }),
    ]);

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Employé introuvable');
    }

    await this.ensureActiveBalances(user, year);
    await this.leaveBalanceSync.syncUserYear(userId, year);

    const balances = await this.prisma.leaveBalance.findMany({
      where: { userId, year },
      select: {
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
        leaveType: { select: { code: true, category: true } },
      },
    });

    const paidBalances = balances.filter((balance) =>
      this.isPaidPoolBalance(balance.leaveType),
    );
    const total = paidBalances.reduce(
      (sum, balance) => sum + balance.acquired + balance.carryover,
      0,
    );
    const taken = this.toNumber(paidTaken._sum.days);
    const scheduled = this.toNumber(paidScheduled._sum.days);
    const annualDays = balances
      .filter(
        (balance) =>
          this.leaveEntitlements.normalizeCode(balance.leaveType.code) === 'CP',
      )
      .reduce((sum, balance) => sum + balance.acquired, 0);
    const passiveDays = balances
      .filter(
        (balance) =>
          this.leaveEntitlements.normalizeCode(balance.leaveType.code) ===
          'PASSIF',
      )
      .reduce(
        (sum, balance) =>
          sum +
          balance.acquired +
          balance.carryover -
          balance.taken -
          balance.scheduled,
        0,
      );
    const childBalanceDays = balances
      .filter(
        (balance) =>
          this.leaveEntitlements.normalizeCode(balance.leaveType.code) ===
          'ENF',
      )
      .reduce((sum, balance) => sum + balance.acquired, 0);
    const fallbackCarryoverDays = paidBalances.reduce(
      (sum, balance) => sum + balance.carryover,
      0,
    );
    const specialLeaveQuota = this.leaveEntitlements.getAcquiredDays({
      leaveType: {
        code: 'SPE',
        name: 'Congé spécial',
        category: LeaveCategory.CONGE_SPECIAL,
        defaultDays: 0,
      },
      user,
      year,
    });
    const specialLeaveDays = this.toNumber(specialLeaves._sum.days);

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      employee: {
        id: user.id,
        name: this.fullName(user),
        poste: user.poste,
      },
      stats: {
        availableDays: this.roundDays(Math.max(total - taken - scheduled, 0)),
        annualDays: this.roundDays(annualDays),
        takenDays: this.roundDays(taken),
        scheduledDays: this.roundDays(scheduled),
        carryoverDays: this.roundDays(passiveDays || fallbackCarryoverDays),
        seniorityBonusDays: this.leaveEntitlements.getSeniorityBonusDays(
          user.dateEmbauche,
        ),
        childBonusDays: childBalanceDays
          ? this.roundDays(childBalanceDays)
          : this.leaveEntitlements.getChildBonusDays(user),
        specialLeaveDays,
        specialLeaveLimit: this.roundDays(specialLeaveQuota),
        pendingRequests,
      },
      nextAbsence: nextAbsence ? this.toNextAbsence(nextAbsence) : null,
    };
  }

  private toNextAbsence(request: {
    id: string;
    reference: string;
    startDate: Date;
    endDate: Date;
    days: number;
    status: LeaveRequestStatus;
    leaveType: { code: string; name: string };
  }) {
    return {
      id: request.id,
      reference: request.reference,
      startDate: request.startDate.toISOString(),
      endDate: request.endDate.toISOString(),
      days: this.roundDays(request.days),
      type: request.leaveType.code,
      typeLabel: request.leaveType.name,
      status: this.toBadgeStatus(request.status),
    };
  }

  private async ensureActiveBalances(user: DashboardUser, year: number) {
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

    await Promise.all(
      activeLeaveTypes.map((leaveType) =>
        this.prisma.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: user.id,
              leaveTypeId: leaveType.id,
              year,
            },
          },
          create: {
            userId: user.id,
            leaveTypeId: leaveType.id,
            year,
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year,
            }),
            carryover: 0,
            taken: 0,
            scheduled: 0,
          },
          update: {
            // Lecture non destructive : ne jamais recalculer un droit acquis
            // existant depuis le tableau de bord. Les recalculs explicites sont
            // déclenchés par RH lors d'une mise à jour de l'employé ou via
            // l'action "Initialiser / synchroniser les soldes".
          },
        }),
      ),
    );
  }

  private toBadgeStatus(status: LeaveRequestStatus): {
    tone: BadgeTone;
    label: string;
  } {
    const statusMap: Record<
      LeaveRequestStatus,
      { tone: BadgeTone; label: string }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'draft', label: 'Brouillon' },
      [LeaveRequestStatus.PENDING]: {
        tone: 'pending',
        label: 'En attente manager',
      },
      [LeaveRequestStatus.IN_REVIEW]: { tone: 'pending', label: 'En revue RH' },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Confirmé RH' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusé' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return statusMap[status];
  }

  private toNumber(value: number | null | undefined) {
    return this.roundDays(value ?? 0);
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private isPaidPoolBalance(leaveType: { code: string }) {
    return PAID_POOL_CODES.has(
      this.leaveEntitlements.normalizeCode(leaveType.code),
    );
  }
}
