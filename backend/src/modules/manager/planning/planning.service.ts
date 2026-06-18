import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveRequestStatus,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindManagerPlanningQueryDto } from './dto/manager-planning.dto';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

const planningUserSelect = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  poste: true,
  department: { select: { id: true, code: true, name: true } },
  leaveRequests: {
    select: {
      id: true,
      reference: true,
      startDate: true,
      endDate: true,
      days: true,
      status: true,
      leaveType: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;

type PlanningUser = Prisma.UserGetPayload<{
  select: typeof planningUserSelect;
}>;

@Injectable()
export class ManagerPlanningService {
  constructor(private readonly prisma: PrismaService) {}

  async findYear(query: FindManagerPlanningQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;
    const ownerWhere = this.buildManagedOwnerWhere(manager);
    const scopedDepartments = this.getManagedDepartments(manager);

    const team = await this.prisma.user.findMany({
      where: ownerWhere,
      orderBy: [
        { department: { name: 'asc' } },
        { nom: 'asc' },
        { prenom: 'asc' },
      ],
      select: {
        ...planningUserSelect,
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
          select: planningUserSelect.leaveRequests.select,
        },
      },
    });

    const userIds = team.map((member) => member.id);
    const balances = userIds.length
      ? await this.prisma.leaveBalance.findMany({
          where: {
            year,
            userId: { in: userIds },
          },
          select: {
            userId: true,
            acquired: true,
            carryover: true,
            taken: true,
            scheduled: true,
            leaveType: { select: { code: true, category: true } },
          },
        })
      : [];

    const balancesByUser = new Map<string, typeof balances>();
    for (const balance of balances) {
      const list = balancesByUser.get(balance.userId) ?? [];
      list.push(balance);
      balancesByUser.set(balance.userId, list);
    }

    const rows = team.map((member) => this.toPlanningRow(member, year));
    const balanceRows = team.map((member) => {
      const memberBalances = balancesByUser.get(member.id) ?? [];
      const total = this.roundDays(
        memberBalances.reduce(
          (sum, balance) => sum + balance.acquired + balance.carryover,
          0,
        ),
      );
      const taken = this.roundDays(
        memberBalances.reduce((sum, balance) => sum + balance.taken, 0),
      );
      const planned = this.roundDays(
        memberBalances.reduce((sum, balance) => sum + balance.scheduled, 0),
      );
      const remaining = this.roundDays(total - taken - planned);
      const passif = this.roundDays(
        memberBalances
          .filter((balance) => balance.leaveType.code === 'PASSIF')
          .reduce(
            (sum, balance) =>
              sum +
              Math.max(
                0,
                balance.acquired +
                  balance.carryover -
                  balance.taken -
                  balance.scheduled,
              ),
            0,
          ),
      );

      return {
        id: member.id,
        employee: this.fullName(member),
        departmentCode: member.department?.code ?? 'N/A',
        departmentName: member.department?.name ?? 'Non affecté',
        manager: this.fullName(manager),
        total,
        taken,
        planned,
        remaining,
        passif,
        alert: this.toBalanceAlert(remaining, passif),
      };
    });

    const planifications = team.flatMap((member) =>
      member.leaveRequests.map((request) => ({
        id: request.id,
        reference: request.reference,
        employee: this.fullName(member),
        departmentCode: member.department?.code ?? 'N/A',
        departmentName: member.department?.name ?? 'Non affecté',
        startDate: this.formatDate(request.startDate),
        endDate: this.formatDate(request.endDate),
        startDateIso: request.startDate.toISOString().slice(0, 10),
        endDateIso: request.endDate.toISOString().slice(0, 10),
        days: this.roundDays(request.days),
        type: request.leaveType.name,
        statusCode: request.status,
        status: this.toPlanificationStatus(request.status).tone,
        label: this.toPlanificationStatus(request.status).label,
      })),
    );

    const monthlyLoad = this.toDepartments(team, scopedDepartments).map(
      (department) => ({
        departmentCode: department.code,
        departmentName: department.name,
        months: Array.from({ length: 12 }, (_, month) =>
          this.roundDays(
            rows
              .filter((row) => row.dept === department.code)
              .reduce((sum, row) => sum + (row.plan[month] ?? 0), 0),
          ),
        ),
      }),
    );

    const submitted = rows.filter((row) => row.soumis).length;
    const plannedDays = this.roundDays(
      rows.reduce((sum, row) => sum + row.total, 0),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: scopedDepartments,
      },
      departments: this.toDepartments(team, scopedDepartments),
      team: rows,
      stats: {
        soumis: submitted,
        total: rows.length,
        brouillon: rows.length - submitted,
        jours: plannedDays,
        taux: rows.length ? Math.round((submitted / rows.length) * 100) : 100,
      },
      monthTotals: this.buildMonthTotals(rows),
      nonSubmitted: rows.filter((row) => !row.soumis),
      rows: balanceRows,
      planifications,
      monthlyLoad,
      totals: {
        employees: balanceRows.length,
        plannedDays: this.roundDays(
          balanceRows.reduce((sum, row) => sum + row.planned, 0),
        ),
        liabilityDays: this.roundDays(
          balanceRows.reduce((sum, row) => sum + row.passif, 0),
        ),
        alerts: balanceRows.filter((row) => row.alert.tone !== 'valid').length,
      },
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

  private toPlanningRow(member: PlanningUser, year: number) {
    const plan = new Array<number>(12).fill(0);
    for (const request of member.leaveRequests) {
      for (let month = 0; month < 12; month += 1) {
        const monthStart = new Date(Date.UTC(year, month, 1));
        const nextMonthStart = new Date(Date.UTC(year, month + 1, 1));
        const overlapStart =
          request.startDate > monthStart ? request.startDate : monthStart;
        const overlapEnd =
          request.endDate < nextMonthStart
            ? request.endDate
            : new Date(nextMonthStart.getTime() - 1);
        if (overlapStart <= overlapEnd) {
          plan[month] += this.countCalendarDays(overlapStart, overlapEnd);
        }
      }
    }

    const roundedPlan = plan.map((value) => this.roundDays(value));
    const total = this.roundDays(
      roundedPlan.reduce((sum, value) => sum + value, 0),
    );

    return {
      id: member.id,
      matricule: member.matricule,
      name: this.fullName(member),
      dept: member.department?.code ?? 'N/A',
      departmentName: member.department?.name ?? 'Non affecté',
      role: member.poste,
      soumis: member.leaveRequests.some(
        (request) => request.status !== LeaveRequestStatus.DRAFT,
      ),
      plan: roundedPlan,
      total,
      requests: member.leaveRequests.map((request) => ({
        id: request.id,
        reference: request.reference,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        days: this.roundDays(request.days),
        type: request.leaveType.name,
        typeCode: request.leaveType.code,
        status: request.status,
      })),
    };
  }

  private buildMonthTotals(rows: Array<{ plan: number[] }>) {
    return Array.from({ length: 12 }, (_, month) =>
      this.roundDays(
        rows.reduce((sum, row) => sum + (row.plan[month] ?? 0), 0),
      ),
    );
  }

  private toDepartments(
    team: Array<{
      department: { id: string; code: string; name: string } | null;
    }>,
    scopedDepartments: Array<{ id: string; code: string; name: string }>,
  ) {
    const departments = new Map<
      string,
      { id: string; code: string; name: string }
    >();
    for (const department of scopedDepartments)
      departments.set(department.code, department);
    for (const member of team) {
      if (member.department)
        departments.set(member.department.code, member.department);
    }

    return Array.from(departments.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  private countCalendarDays(start: Date, end: Date) {
    const startMs = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
    );
    const endMs = Date.UTC(
      end.getUTCFullYear(),
      end.getUTCMonth(),
      end.getUTCDate(),
    );

    return Math.max(0, Math.floor((endMs - startMs) / 86_400_000) + 1);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value);
  }

  private toPlanificationStatus(status: LeaveRequestStatus) {
    const mapping: Record<
      LeaveRequestStatus,
      { tone: 'planned' | 'pending' | 'review' | 'valid' | 'rejected' | 'neutral' | 'draft'; label: string }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'planned', label: 'Planifié' },
      [LeaveRequestStatus.PENDING]: { tone: 'pending', label: 'Soumis' },
      [LeaveRequestStatus.IN_REVIEW]: { tone: 'review', label: 'En revue' },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Confirmé' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Rejeté' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return mapping[status];
  }

  private toBalanceAlert(remaining: number, passif: number) {
    if (remaining < 0) return { tone: 'rejected', label: 'Négatif' };
    if (passif > 0) return { tone: 'pending', label: 'Passif' };
    return { tone: 'valid', label: 'OK' };
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
