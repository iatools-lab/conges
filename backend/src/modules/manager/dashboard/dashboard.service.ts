import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConflictStatus,
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindManagerDashboardQueryDto } from './dto/manager-dashboard.dto';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { LeaveBalanceInitializerService } from '../../shared/leave-balances/leave-balance-initializer.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';
import {
  getLeaveYearRange,
  getLeaveYearsForPeriod,
} from '../../../common/leave-year';
import {
  expandHolidayDateKeys,
  utcDateKey,
} from '../../../common/working-days';
import {
  paidPassifRemaining,
  summarizePaidLeavePool,
} from '../../shared/leave-balances/leave-balance-pools';

type LeaveBarStatus = 'draft' | 'pending' | 'manager' | 'rh' | 'conflict';

const dashboardUserSelect = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  poste: true,
  sexe: true,
  dateEmbauche: true,
  passifInitial: true,
  department: { select: { id: true, code: true, name: true } },
  children: { select: { dateNaissance: true } },
  events: {
    where: { type: EventType.BIRTH, processed: true },
    select: { type: true, eventDate: true, processed: true },
  },
  leaveRequests: {
    select: {
      id: true,
      reference: true,
      startDate: true,
      endDate: true,
      days: true,
      status: true,
      submittedAt: true,
      leaveType: { select: { code: true, name: true, category: true } },
      conflicts: { select: { status: true } },
    },
  },
} satisfies Prisma.UserSelect;

type DashboardUser = Prisma.UserGetPayload<{
  select: typeof dashboardUserSelect;
}>;

@Injectable()
export class ManagerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
  ) {}

  async findSummary(query: FindManagerDashboardQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const nextSevenDaysStart = new Date(todayStart);
    nextSevenDaysStart.setUTCDate(nextSevenDaysStart.getUTCDate() + 7);
    const urgentThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const range = resolveDateRange(query, { defaultMode: 'month', now });
    const year = range.year;
    const month = query.month ?? range.month ?? now.getUTCMonth() + 1;
    const monthStart = range.dateFrom ?? new Date(Date.UTC(year, month - 1, 1));
    const nextMonthStart =
      range.endExclusive ?? new Date(Date.UTC(year, month, 1));
    const leaveYearRange = getLeaveYearRange(year);
    const ownerWhere = this.buildManagedOwnerWhere(manager);
    const actionOwnerWhere = this.buildActionOwnerWhere(manager);
    const scopedDepartments = this.getManagedDepartments(manager);
    const departmentIds = scopedDepartments.map((department) => department.id);

    const [
      team,
      pendingRequests,
      activeConflicts,
      annualPlannedOwners,
      urgentPendingRequests,
      upcomingAbsenceOwners,
      oldestPendingRequests,
      holidayRules,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: ownerWhere,
        orderBy: [
          { department: { name: 'asc' } },
          { nom: 'asc' },
          { prenom: 'asc' },
        ],
        select: {
          ...dashboardUserSelect,
          leaveRequests: {
            where: {
              status: {
                notIn: [
                  LeaveRequestStatus.REJECTED,
                  LeaveRequestStatus.CANCELLED,
                ],
              },
              ...overlapDateWhere(range),
            },
            orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
            select: dashboardUserSelect.leaveRequests.select,
          },
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          status: LeaveRequestStatus.PENDING,
          ...overlapDateWhere(range),
          owner: actionOwnerWhere,
        },
      }),
      this.prisma.conflict.count({
        where: {
          status: ConflictStatus.ACTIVE,
          ...(range.endExclusive
            ? { periodStart: { lt: range.endExclusive } }
            : {}),
          ...(range.dateFrom ? { periodEnd: { gte: range.dateFrom } } : {}),
          OR: [
            ...(departmentIds.length
              ? [{ departmentId: { in: departmentIds } }]
              : []),
            { request: { owner: ownerWhere } },
          ],
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: {
            notIn: [LeaveRequestStatus.REJECTED, LeaveRequestStatus.CANCELLED],
          },
          ...overlapDateWhere(range),
          owner: ownerWhere,
        },
        distinct: ['ownerId'],
        select: { ownerId: true },
      }),
      this.prisma.leaveRequest.count({
        where: {
          status: LeaveRequestStatus.PENDING,
          submittedAt: { not: null, lte: urgentThreshold },
          ...overlapDateWhere(range),
          owner: actionOwnerWhere,
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: {
            notIn: [LeaveRequestStatus.REJECTED, LeaveRequestStatus.CANCELLED],
          },
          AND: [
            { startDate: { lt: nextSevenDaysStart } },
            { endDate: { gte: todayStart } },
            overlapDateWhere(range),
          ],
          owner: ownerWhere,
        },
        distinct: ['ownerId'],
        select: { ownerId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: LeaveRequestStatus.PENDING,
          submittedAt: { not: null },
          ...overlapDateWhere(range),
          owner: actionOwnerWhere,
        },
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        take: 5,
        select: {
          id: true,
          reference: true,
          startDate: true,
          endDate: true,
          submittedAt: true,
          owner: { select: { nom: true, prenom: true, matricule: true } },
          leaveType: {
            select: { code: true, name: true, category: true },
          },
        },
      }),
      this.prisma.publicHoliday.findMany({
        where: {
          country: 'CM',
          OR: [
            { date: { gte: monthStart, lt: nextMonthStart } },
            { recurring: true },
          ],
        },
        orderBy: { date: 'asc' },
        select: { id: true, date: true, name: true, recurring: true },
      }),
    ]);

    const holidayDates = expandHolidayDateKeys(
      holidayRules,
      monthStart,
      new Date(nextMonthStart.getTime() - 1),
    );

    const sortedTeam = team.slice().sort((left, right) => {
      const recentDiff =
        this.memberRecentLeaveMs(right) - this.memberRecentLeaveMs(left);
      if (recentDiff !== 0) return recentDiff;

      return this.fullName(left).localeCompare(this.fullName(right));
    });
    const plannedOwnerIds = new Set(
      annualPlannedOwners.map((row) => row.ownerId),
    );
    const rows = sortedTeam.map((member) =>
      this.toTeamMember(member, monthStart, nextMonthStart),
    );
    const absentEmployees = rows.filter(
      (member) => member.bars.length > 0,
    ).length;

    const teamIds = sortedTeam.map((member) => member.id);
    await this.initializeVisibleTeamBalances(sortedTeam, year);
    await this.syncVisibleTeamBalances(ownerWhere, leaveYearRange);

    const rawBalances = teamIds.length
      ? await this.prisma.leaveBalance.findMany({
          where: { year, userId: { in: teamIds } },
          select: {
            userId: true,
            acquired: true,
            carryover: true,
            taken: true,
            scheduled: true,
            leaveType: { select: { code: true, name: true, category: true } },
          },
        })
      : [];

    const balancesByUser = new Map<string, typeof rawBalances>();
    for (const balance of rawBalances) {
      const list = balancesByUser.get(balance.userId) ?? [];
      list.push(balance);
      balancesByUser.set(balance.userId, list);
    }

    const balances = sortedTeam.map((member) => {
      const memberBalances = balancesByUser.get(member.id) ?? [];
      const paidSummary = summarizePaidLeavePool(memberBalances);
      const total = paidSummary.acquired;
      const taken = paidSummary.taken;
      const planned = paidSummary.scheduled;
      const remaining = paidSummary.remaining;
      const passif = paidPassifRemaining(memberBalances);
      const alert =
        remaining < 0
          ? ('negative' as const)
          : passif > 0
            ? ('passif' as const)
            : remaining < 5
              ? ('low' as const)
              : ('ok' as const);
      return {
        id: member.id,
        name: this.fullName(member),
        matricule: member.matricule,
        department: member.department?.name ?? 'Non affect\u00e9',
        departmentCode: member.department?.code ?? 'N/A',
        total,
        taken,
        planned,
        remaining,
        passif,
        alert,
      };
    });
    const paidTotalDays = this.roundDays(
      balances.reduce((sum, balance) => sum + balance.total, 0),
    );
    const paidTakenDays = this.roundDays(
      balances.reduce((sum, balance) => sum + balance.taken, 0),
    );
    const paidPlannedDays = this.roundDays(
      balances.reduce((sum, balance) => sum + balance.planned, 0),
    );
    const paidRemainingDays = this.roundDays(
      balances.reduce((sum, balance) => sum + balance.remaining, 0),
    );
    const lowBalanceEmployees = balances.filter(
      (balance) => balance.alert === 'low',
    ).length;
    const negativeBalanceEmployees = balances.filter(
      (balance) => balance.alert === 'negative',
    ).length;
    const passifEmployees = balances.filter(
      (balance) => balance.alert === 'passif',
    ).length;
    const balanceAlerts =
      lowBalanceEmployees + negativeBalanceEmployees + passifEmployees;
    const totalAbsenceDays = rows.reduce(
      (sum, member) =>
        sum +
        member.bars.reduce((memberSum, bar) => {
          let workingDays = 0;
          for (let day = bar.s; day <= bar.e; day += 1) {
            const date = new Date(Date.UTC(year, month - 1, day));
            const weekDay = date.getUTCDay();
            if (
              weekDay !== 0 &&
              weekDay !== 6 &&
              !holidayDates.has(utcDateKey(date))
            ) {
              workingDays += 1;
            }
          }
          return memberSum + workingDays;
        }, 0),
      0,
    );
    const annualPlansMissing = sortedTeam.filter(
      (member) => !plannedOwnerIds.has(member.id),
    ).length;
    const planningRate = sortedTeam.length
      ? Math.round(
          ((sortedTeam.length - annualPlansMissing) / sortedTeam.length) * 100,
        )
      : 100;

    return {
      year,
      month,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: scopedDepartments,
      },
      stats: {
        totalLeaves: totalAbsenceDays,
        paidTotalDays,
        paidTakenDays,
        paidPlannedDays,
        paidRemainingDays,
        balanceAlerts,
        lowBalanceEmployees,
        negativeBalanceEmployees,
        passifEmployees,
        pendingRequests,
        urgentPendingRequests,
        upcomingAbsences7d: upcomingAbsenceOwners.length,
        absentEmployees,
        activeConflicts,
        annualPlansMissing,
        planningRate,
        totalAbsenceDays,
        teamSize: sortedTeam.length,
      },
      balances,
      attention: {
        oldestPending: oldestPendingRequests.map((request) => ({
          id: request.id,
          reference: request.reference,
          employeeName: this.fullName(request.owner),
          matricule: request.owner.matricule,
          type: this.toLeaveTypeLabel(request.leaveType),
          startDate: request.startDate.toISOString(),
          endDate: request.endDate.toISOString(),
          submittedAt: request.submittedAt?.toISOString() ?? null,
        })),
      },
      holidays: holidayRules.flatMap((holiday) =>
        [
          ...expandHolidayDateKeys(
            [holiday],
            monthStart,
            new Date(nextMonthStart.getTime() - 1),
          ),
        ].map((date) => ({ id: holiday.id, date, name: holiday.name })),
      ),
      team: rows,
    };
  }

  private async resolveManager(managerId?: string, managerEmail?: string) {
    const where = managerId?.trim()
      ? { id: managerId.trim() }
      : managerEmail?.trim()
        ? { email: managerEmail.trim().toLowerCase() }
        : null;

    if (!where) throw new BadRequestException('Manager requis');

    const manager = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        status: true,
        department: { select: { id: true, code: true, name: true } },
        managedDepartments: { select: { id: true, code: true, name: true } },
        roles: { select: { role: true, scope: true } },
      },
    });

    if (!manager || manager.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Manager introuvable');
    }
    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);
    const hasManagerRole = manager.roles.some(
      (role) => role.role === RoleType.MANAGER,
    );
    if (!hasManagerRole && scopedDepartmentIds.length === 0) {
      throw new ForbiddenException('Utilisateur sans equipe sous autorite');
    }

    return manager;
  }

  private buildManagedOwnerWhere(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);

    return {
      id: { not: manager.id },
      status: { not: UserStatus.INACTIVE },
      OR: [
        { departmentId: { in: scopedDepartmentIds } },
        { n1Id: manager.id },
        { n2Id: manager.id },
        { n3Id: manager.id },
      ],
    } satisfies Prisma.UserWhereInput;
  }

  private buildActionOwnerWhere(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    return {
      id: { not: manager.id },
      status: { not: UserStatus.INACTIVE },
      n1Id: manager.id,
    } satisfies Prisma.UserWhereInput;
  }

  private getManagerDepartment(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    if (!manager.department) {
      throw new ForbiddenException('Manager sans département affecté');
    }

    return manager.department;
  }

  private getManagedDepartments(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    return manager.managedDepartments;
  }

  private getScopedDepartmentIds(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    return Array.from(
      new Set([
        ...manager.managedDepartments.map((department) => department.id),
      ]),
    );
  }

  private toTeamMember(
    member: DashboardUser,
    monthStart: Date,
    nextMonthStart: Date,
  ) {
    const daysInMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    ).getUTCDate();

    return {
      id: member.id,
      name: this.fullName(member),
      matricule: member.matricule,
      role: member.poste,
      department: member.department?.name ?? 'Non affecté',
      departmentCode: member.department?.code ?? 'N/A',
      bars: member.leaveRequests.map((request) => ({
        id: request.id,
        reference: request.reference,
        s: this.toMonthDay(
          request.startDate < monthStart ? monthStart : request.startDate,
        ),
        e: Math.min(
          daysInMonth,
          this.toMonthDay(
            request.endDate >= nextMonthStart
              ? new Date(nextMonthStart.getTime() - 1)
              : request.endDate,
          ),
        ),
        type: this.toLeaveTypeLabel(request.leaveType),
        status: this.toLeaveStatus(request.status, request.conflicts),
        statusLabel: this.toLeaveStatusLabel(request.status, request.conflicts),
        isPlanned:
          request.status === LeaveRequestStatus.DRAFT &&
          request.submittedAt === null,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        days: this.roundDays(request.days),
      })),
    };
  }

  private async syncVisibleTeamBalances(
    ownerWhere: Prisma.UserWhereInput,
    range: ReturnType<typeof getLeaveYearRange>,
  ) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        owner: ownerWhere,
        startDate: { lt: range.endExclusive },
        endDate: { gte: range.start },
      },
      select: {
        ownerId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
      },
    });

    await this.leaveBalanceSync.syncForKeys(
      requests.flatMap((request) =>
        getLeaveYearsForPeriod(request.startDate, request.endDate).map(
          (leaveYear) => ({
            userId: request.ownerId,
            leaveTypeId: request.leaveTypeId,
            year: leaveYear,
          }),
        ),
      ),
    );
  }

  private async initializeVisibleTeamBalances(
    team: DashboardUser[],
    year: number,
  ) {
    if (!team.length) return;

    await Promise.all(
      team.map((member) =>
        this.leaveBalanceInitializer.initializeUserYear(member.id, year),
      ),
    );
  }

  private memberRecentLeaveMs(member: DashboardUser) {
    return member.leaveRequests.reduce(
      (max, request) => Math.max(max, request.startDate.getTime()),
      0,
    );
  }

  private toLeaveTypeLabel(leaveType: {
    code: string;
    name: string;
    category: LeaveCategory;
  }) {
    const code = leaveType.code.toUpperCase();
    if (code === 'CP') return 'CP';
    if (code === 'RTT') return 'RTT';
    if (code === 'PASSIF') return 'Passif';
    if (leaveType.category === LeaveCategory.CONGE_SPECIAL)
      return 'Sp\u00e9cial';
    if (leaveType.category === LeaveCategory.CONGE_MALADIE) return 'Maladie';
    if (leaveType.category === LeaveCategory.CONGE_SANS_SOLDE)
      return 'Sans solde';

    return leaveType.name;
  }

  private toLeaveStatus(
    status: LeaveRequestStatus,
    conflicts: Array<{ status: ConflictStatus }>,
  ): LeaveBarStatus {
    if (
      conflicts.some((conflict) => conflict.status === ConflictStatus.ACTIVE)
    ) {
      return 'conflict';
    }

    const statusMap: Record<LeaveRequestStatus, LeaveBarStatus> = {
      [LeaveRequestStatus.DRAFT]: 'draft',
      [LeaveRequestStatus.PENDING]: 'pending',
      [LeaveRequestStatus.IN_REVIEW]: 'manager',
      [LeaveRequestStatus.APPROVED]: 'rh',
      [LeaveRequestStatus.REJECTED]: 'draft',
      [LeaveRequestStatus.CANCELLED]: 'draft',
    };

    return statusMap[status];
  }

  private toLeaveStatusLabel(
    status: LeaveRequestStatus,
    conflicts: Array<{ status: ConflictStatus }>,
  ) {
    if (
      conflicts.some((conflict) => conflict.status === ConflictStatus.ACTIVE)
    ) {
      return 'Conflit';
    }

    const statusMap: Record<LeaveRequestStatus, string> = {
      [LeaveRequestStatus.DRAFT]: 'Brouillon',
      [LeaveRequestStatus.PENDING]: 'Soumis',
      [LeaveRequestStatus.IN_REVIEW]: 'En revue RH',
      [LeaveRequestStatus.APPROVED]: 'Validé RH',
      [LeaveRequestStatus.REJECTED]: 'Refusé',
      [LeaveRequestStatus.CANCELLED]: 'Annulé',
    };

    return statusMap[status];
  }

  private toMonthDay(date: Date) {
    return date.getUTCDate();
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
