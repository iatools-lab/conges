import { Injectable } from '@nestjs/common';
import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

type DashboardAlertTone = 'valid' | 'pending' | 'rejected' | 'info' | 'neutral';
type DashboardLeaveTone =
  | 'valid'
  | 'pending'
  | 'rejected'
  | 'draft'
  | 'info'
  | 'neutral'
  | 'review'
  | 'planned';

const DASHBOARD_REQUEST_STATUSES = [
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.REJECTED,
  LeaveRequestStatus.CANCELLED,
];
const PAID_POOL_CODES = ['CP', 'ANC', 'ENF', 'PASSIF'] as const;

const dashboardLeaveSelect = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  status: true,
  submittedAt: true,
  leaveType: { select: { code: true, name: true } },
  owner: {
    select: {
      nom: true,
      prenom: true,
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type DashboardLeave = Prisma.LeaveRequestGetPayload<{
  select: typeof dashboardLeaveSelect;
}>;

@Injectable()
export class RhDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
  ) {}

  async findSummary(
    query: { dateFrom?: string; dateTo?: string; year?: string } = {},
  ) {
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    await this.leaveBalanceSync.syncYear(year);
    await this.ensurePaidBalances(year);

    const [
      activeEmployees,
      onLeaveEmployees,
      inactiveEmployees,
      balances,
      specialLeaves,
      employeesWithoutPlanning,
      activeConflicts,
      pendingRequests,
      pendingEvents,
      takenLeaves,
      departments,
      unassignedEmployees,
      leaves,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.ON_LEAVE } }),
      this.prisma.user.count({ where: { status: UserStatus.INACTIVE } }),
      this.prisma.leaveBalance.aggregate({
        where: {
          year,
          user: { status: { not: UserStatus.INACTIVE } },
          leaveType: { code: { in: [...PAID_POOL_CODES] } },
        },
        _sum: {
          acquired: true,
          carryover: true,
          scheduled: true,
          taken: true,
        },
      }),
      this.prisma.leaveRequest.aggregate({
        where: {
          status: LeaveRequestStatus.APPROVED,
          ...overlapDateWhere(range),
          leaveType: { category: LeaveCategory.CONGE_SPECIAL },
        },
        _sum: { days: true },
      }),
      this.prisma.user.count({
        where: {
          status: UserStatus.ACTIVE,
          NOT: {
            balances: {
              some: {
                year,
                scheduled: { gt: 0 },
                leaveType: { code: { in: [...PAID_POOL_CODES] } },
              },
            },
          },
        },
      }),
      this.prisma.conflict.count({ where: { status: 'ACTIVE' } }),
      this.prisma.leaveRequest.count({
        where: {
          status: {
            in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
          },
          ...overlapDateWhere(range),
        },
      }),
      this.prisma.event.count({ where: { processed: false } }),
      this.prisma.leaveRequest.aggregate({
        where: {
          status: LeaveRequestStatus.APPROVED,
          ...overlapDateWhere(range),
          owner: { status: { not: UserStatus.INACTIVE } },
          leaveType: { code: { in: [...PAID_POOL_CODES] } },
        },
        _sum: { days: true },
      }),
      this.prisma.department.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          employees: {
            where: { status: { in: [UserStatus.ACTIVE, UserStatus.ON_LEAVE] } },
            select: { id: true },
          },
        },
      }),
      this.prisma.user.count({
        where: {
          departmentId: null,
          status: { in: [UserStatus.ACTIVE, UserStatus.ON_LEAVE] },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          ...overlapDateWhere(range),
          status: { in: DASHBOARD_REQUEST_STATUSES },
        },
        orderBy: [{ startDate: 'desc' }, { reference: 'desc' }],
        select: dashboardLeaveSelect,
      }),
    ]);

    const acquiredDays = this.toNumber(balances._sum.acquired);
    const carryoverDays = this.toNumber(balances._sum.carryover);
    const plannedDays = this.toNumber(balances._sum.scheduled);
    const takenDays = this.toNumber(takenLeaves._sum.days);
    const remainingLiability = this.roundDays(
      Math.max(acquiredDays + carryoverDays - takenDays - plannedDays, 0),
    );
    const complianceAlerts =
      employeesWithoutPlanning + activeConflicts + pendingEvents;
    const leaveRows = leaves.map((leave) => this.toDashboardLeaveRow(leave));
    const plannedLeaves = this.sortDashboardLeavesDesc(
      leaveRows.filter((leave) => leave.kind === 'planned'),
    );
    const requestLeaves = this.sortDashboardLeavesDesc(
      leaveRows.filter((leave) => leave.kind === 'request'),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      stats: {
        activeEmployees,
        onLeaveEmployees,
        inactiveEmployees,
        plannedDays,
        takenDays,
        remainingLiability,
        specialLeavesUsed: this.toNumber(specialLeaves._sum.days),
        employeesWithoutPlanning,
        complianceAlerts,
        pendingRequests,
        activeConflicts,
        pendingEvents,
      },
      alerts: this.buildAlerts({
        employeesWithoutPlanning,
        activeConflicts,
        pendingEvents,
        pendingRequests,
      }),
      plannedLeaves,
      requestLeaves,
      departments: this.buildDepartmentDistribution(
        departments.map((department) => ({
          label: department.name,
          count: department.employees.length,
        })),
        unassignedEmployees,
      ),
    };
  }

  private async ensurePaidBalances(year: number) {
    const [leaveTypes, users] = await Promise.all([
      this.prisma.leaveType.findMany({
        where: { active: true, code: { in: [...PAID_POOL_CODES] } },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
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
    ]);

    if (!leaveTypes.length || !users.length) return;

    await Promise.all(
      users.flatMap((user) =>
        leaveTypes.map((leaveType) => {
          const acquired = this.leaveEntitlements.getAcquiredDays({
            leaveType,
            user,
            year,
          });

          return this.prisma.leaveBalance.upsert({
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
              acquired,
              carryover: 0,
              taken: 0,
              scheduled: 0,
            },
            update: { acquired },
          });
        }),
      ),
    );
  }

  private buildAlerts(counts: {
    employeesWithoutPlanning: number;
    activeConflicts: number;
    pendingEvents: number;
    pendingRequests: number;
  }) {
    const alerts: { label: string; tone: DashboardAlertTone }[] = [];

    if (counts.employeesWithoutPlanning > 0) {
      alerts.push({
        label: `${counts.employeesWithoutPlanning} employé(s) sans planning annuel.`,
        tone: 'pending',
      });
    }
    if (counts.pendingRequests > 0) {
      alerts.push({
        label: `${counts.pendingRequests} demande(s) en attente de validation.`,
        tone: 'info',
      });
    }
    if (counts.activeConflicts > 0) {
      alerts.push({
        label: `${counts.activeConflicts} conflit(s) d'absence actif(s).`,
        tone: 'rejected',
      });
    }
    if (counts.pendingEvents > 0) {
      alerts.push({
        label: `${counts.pendingEvents} événement(s) RH à traiter.`,
        tone: 'pending',
      });
    }

    return alerts.length
      ? alerts
      : [{ label: 'Aucune alerte RH active.', tone: 'valid' as const }];
  }

  private toDashboardLeaveRow(request: DashboardLeave) {
    const isPlanned =
      request.status === LeaveRequestStatus.DRAFT &&
      request.submittedAt === null;
    const status = this.toLeaveStatus(request.status, isPlanned);

    return {
      id: request.id,
      reference: request.reference,
      employee: this.fullName(request.owner),
      department: request.owner.department?.name ?? 'Sans département',
      type: request.leaveType.code || request.leaveType.name,
      startDate: this.toInputDate(request.startDate),
      endDate: this.toInputDate(request.endDate),
      days: this.roundDays(request.days),
      statusCode: request.status,
      status: status.tone,
      statusLabel: status.label,
      kind: isPlanned ? ('planned' as const) : ('request' as const),
    };
  }

  private sortDashboardLeavesDesc<
    T extends { startDate: string; endDate: string; reference: string },
  >(rows: T[]) {
    return rows.slice().sort((left, right) => {
      const startDiff = right.startDate.localeCompare(left.startDate);
      if (startDiff !== 0) return startDiff;

      const endDiff = right.endDate.localeCompare(left.endDate);
      if (endDiff !== 0) return endDiff;

      return right.reference.localeCompare(left.reference);
    });
  }

  private toLeaveStatus(
    status: LeaveRequestStatus,
    isPlanned: boolean,
  ): { tone: DashboardLeaveTone; label: string } {
    if (isPlanned) return { tone: 'planned', label: 'Planifié' };

    const statusMap: Record<
      LeaveRequestStatus,
      { tone: DashboardLeaveTone; label: string }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'draft', label: 'À revoir' },
      [LeaveRequestStatus.PENDING]: { tone: 'pending', label: 'Demandé' },
      [LeaveRequestStatus.IN_REVIEW]: { tone: 'review', label: 'En revue RH' },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Pris / confirmé' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusé' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return statusMap[status];
  }

  private buildDepartmentDistribution(
    departments: { label: string; count: number }[],
    unassignedEmployees: number,
  ) {
    const rows = unassignedEmployees
      ? [
          ...departments,
          { label: 'Sans département', count: unassignedEmployees },
        ]
      : departments;
    const total = rows.reduce((sum, department) => sum + department.count, 0);
    const tones = [
      'blue',
      'green',
      'orange',
      'purple',
      'yellow',
      'red',
    ] as const;

    return rows
      .filter((department) => department.count > 0)
      .map((department, index) => ({
        label: department.label,
        count: department.count,
        percent: total ? Math.round((department.count / total) * 100) : 0,
        tone: tones[index % tones.length],
      }));
  }

  private toNumber(value: number | null | undefined) {
    return this.roundDays(value ?? 0);
  }

  private toInputDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
