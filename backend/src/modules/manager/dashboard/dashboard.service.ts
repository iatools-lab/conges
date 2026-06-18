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
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';

type LeaveBarStatus = 'draft' | 'pending' | 'manager' | 'rh' | 'conflict';
const REGULAR_PAID_CODES = new Set(['CP', 'ANC', 'ENF']);

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
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
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
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const nextMonthStart = new Date(Date.UTC(year, month, 1));
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
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
                startDate: { lt: nextMonthStart },
                endDate: { gte: monthStart },
              },
              orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
              select: dashboardUserSelect.leaveRequests.select,
            },
          },
        }),
        this.prisma.leaveRequest.count({
          where: {
            status: LeaveRequestStatus.PENDING,
            startDate: { gte: yearStart, lt: nextYearStart },
            owner: actionOwnerWhere,
          },
        }),
        this.prisma.conflict.count({
          where: {
            status: ConflictStatus.ACTIVE,
            periodStart: { lt: nextMonthStart },
            periodEnd: { gte: monthStart },
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
              notIn: [
                LeaveRequestStatus.REJECTED,
                LeaveRequestStatus.CANCELLED,
              ],
            },
            startDate: { gte: yearStart, lt: nextYearStart },
            owner: ownerWhere,
          },
          distinct: ['ownerId'],
          select: { ownerId: true },
        }),
        this.prisma.leaveRequest.count({
          where: {
            status: LeaveRequestStatus.PENDING,
            submittedAt: { not: null, lte: urgentThreshold },
            owner: actionOwnerWhere,
          },
        }),
        this.prisma.leaveRequest.findMany({
          where: {
            status: {
              notIn: [
                LeaveRequestStatus.REJECTED,
                LeaveRequestStatus.CANCELLED,
              ],
            },
            startDate: { lt: nextSevenDaysStart },
            endDate: { gte: todayStart },
            owner: ownerWhere,
          },
          distinct: ['ownerId'],
          select: { ownerId: true },
        }),
        this.prisma.leaveRequest.findMany({
          where: {
            status: LeaveRequestStatus.PENDING,
            submittedAt: { not: null },
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
      ]);

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
    await this.syncVisibleTeamBalances(ownerWhere, yearStart, nextYearStart);
    await this.ensureTeamActiveBalances(sortedTeam, year);

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
      const mainBalances = memberBalances.filter(
        (b) => this.isRegularPaidBalance(b.leaveType),
      );
      const passifBalance = memberBalances.find(
        (b) => b.leaveType.code.toUpperCase() === 'PASSIF',
      );
      const total = this.roundDays(
        mainBalances.reduce((sum, b) => sum + b.acquired + b.carryover, 0),
      );
      const taken = this.roundDays(
        mainBalances.reduce((sum, b) => sum + b.taken, 0),
      );
      const planned = this.roundDays(
        mainBalances.reduce((sum, b) => sum + b.scheduled, 0),
      );
      const remaining = this.roundDays(total - taken - planned);
      const passif = passifBalance
        ? this.roundDays(
            passifBalance.acquired +
              passifBalance.carryover -
              passifBalance.taken -
              passifBalance.scheduled,
          )
        : 0;
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
    const totalAbsenceDays = rows.reduce(
      (sum, member) =>
        sum +
        member.bars.reduce(
          (memberSum, bar) => memberSum + (bar.e - bar.s + 1),
          0,
        ),
      0,
    );
    const annualPlansMissing = sortedTeam.filter(
      (member) => !plannedOwnerIds.has(member.id),
    ).length;
    const planningRate = sortedTeam.length
      ? Math.round(((sortedTeam.length - annualPlansMissing) / sortedTeam.length) * 100)
      : 100;

    return {
      year,
      month,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: scopedDepartments,
      },
      stats: {
        totalLeaves: totalAbsenceDays,
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
    yearStart: Date,
    nextYearStart: Date,
  ) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        owner: ownerWhere,
        startDate: { gte: yearStart, lt: nextYearStart },
      },
      select: { ownerId: true, leaveTypeId: true, startDate: true },
    });

    await this.leaveBalanceSync.syncForKeys(
      requests.map((request) => ({
        userId: request.ownerId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
      })),
    );
  }

  private async ensureTeamActiveBalances(team: DashboardUser[], year: number) {
    if (!team.length) return;

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
      team.flatMap((member) =>
        activeLeaveTypes.map((leaveType) => {
          const acquired = this.leaveEntitlements.getAcquiredDays({
            leaveType,
            user: member,
            year,
          });

          return this.prisma.leaveBalance.upsert({
            where: {
              userId_leaveTypeId_year: {
                userId: member.id,
                leaveTypeId: leaveType.id,
                year,
              },
            },
            create: {
              userId: member.id,
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
    if (leaveType.category === LeaveCategory.CONGE_SPECIAL) return 'Sp\u00e9cial';
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

  private isRegularPaidBalance(leaveType: { code: string }) {
    return REGULAR_PAID_CODES.has(leaveType.code.trim().toUpperCase());
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
