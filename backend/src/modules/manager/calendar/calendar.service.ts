import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConflictStatus,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindManagerCalendarQueryDto } from './dto/manager-calendar.dto';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

const calendarRequestSelect = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  status: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      poste: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
  leaveType: { select: { code: true, name: true, category: true } },
  conflicts: { select: { status: true } },
} satisfies Prisma.LeaveRequestSelect;

type CalendarRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof calendarRequestSelect;
}>;

@Injectable()
export class ManagerCalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async findMonth(query: FindManagerCalendarQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const now = new Date();
    const range = resolveDateRange(query, { defaultMode: 'month', now });
    const year = range.year;
    const month = query.month ?? range.month ?? now.getUTCMonth() + 1;
    const monthStart =
      range.dateFrom ?? new Date(Date.UTC(year, month - 1, 1));
    const nextMonthStart =
      range.endExclusive ?? new Date(Date.UTC(year, month, 1));
    const ownerWhere = this.buildManagedOwnerWhere(manager);
    const scopedDepartments = this.getManagedDepartments(manager);

    const [team, requests] = await Promise.all([
      this.prisma.user.findMany({
        where: ownerWhere,
        orderBy: [
          { department: { name: 'asc' } },
          { nom: 'asc' },
          { prenom: 'asc' },
        ],
        select: {
          id: true,
          nom: true,
          prenom: true,
          poste: true,
          department: { select: { id: true, code: true, name: true } },
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
        orderBy: [
          { startDate: 'asc' },
          { owner: { nom: 'asc' } },
          { reference: 'asc' },
        ],
        select: calendarRequestSelect,
      }),
    ]);

    const leaves = requests.map((request) =>
      this.toCalendarLeave(request, monthStart, nextMonthStart),
    );

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
      departments: this.toDepartments(team, scopedDepartments),
      leaveTypes: this.toLeaveTypes(requests),
      summary: {
        teamSize: team.length,
        periods: leaves.length,
        totalDays: this.roundDays(
          leaves.reduce((sum, leave) => sum + leave.days, 0),
        ),
        activeConflicts: leaves.filter((leave) => leave.status === 'conflict')
          .length,
      },
      leaves,
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

  private toCalendarLeave(
    request: CalendarRequest,
    monthStart: Date,
    nextMonthStart: Date,
  ) {
    const startDate =
      request.startDate < monthStart ? monthStart : request.startDate;
    const endDate =
      request.endDate >= nextMonthStart
        ? new Date(nextMonthStart.getTime() - 1)
        : request.endDate;
    const leaveType = this.toLeaveType(request.leaveType);

    return {
      id: request.id,
      reference: request.reference,
      employeeId: request.owner.id,
      employeeName: this.fullName(request.owner),
      employeeRole: request.owner.poste,
      matricule: request.owner.matricule,
      department: request.owner.department
        ? {
            id: request.owner.department.id,
            code: request.owner.department.code,
            name: request.owner.department.name,
          }
        : null,
      leaveType,
      status: this.toStatus(request.status, request.conflicts),
      statusLabel: this.toStatusLabel(request.status, request.conflicts),
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      originalStartDate: request.startDate.toISOString(),
      originalEndDate: request.endDate.toISOString(),
      days: this.roundDays(request.days),
    };
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
    for (const department of scopedDepartments) {
      departments.set(department.code, department);
    }
    for (const member of team) {
      if (member.department)
        departments.set(member.department.code, member.department);
    }

    return Array.from(departments.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  private toLeaveTypes(requests: CalendarRequest[]) {
    const types = new Map<string, ReturnType<typeof this.toLeaveType>>();
    for (const request of requests) {
      const leaveType = this.toLeaveType(request.leaveType);
      types.set(leaveType.code, leaveType);
    }

    return Array.from(types.values()).sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }

  private toLeaveType(leaveType: {
    code: string;
    name: string;
    category: LeaveCategory;
  }) {
    const code = leaveType.code.toUpperCase();
    if (code === 'CP') return { code: 'CP', label: 'Congés payés' };
    if (code === 'RTT') return { code: 'RTT', label: 'RTT' };
    if (leaveType.category === LeaveCategory.CONGE_SPECIAL)
      return { code: 'SPE', label: 'Spécial' };
    if (leaveType.category === LeaveCategory.CONGE_MALADIE)
      return { code: 'MAL', label: 'Maladie' };
    if (leaveType.category === LeaveCategory.CONGE_SANS_SOLDE)
      return { code: 'SAN', label: 'Sans solde' };

    return { code, label: leaveType.name };
  }

  private toStatus(
    status: LeaveRequestStatus,
    conflicts: Array<{ status: ConflictStatus }>,
  ) {
    if (
      conflicts.some((conflict) => conflict.status === ConflictStatus.ACTIVE)
    ) {
      return 'conflict';
    }

    const statusMap: Record<LeaveRequestStatus, string> = {
      [LeaveRequestStatus.DRAFT]: 'draft',
      [LeaveRequestStatus.PENDING]: 'pending',
      [LeaveRequestStatus.IN_REVIEW]: 'manager',
      [LeaveRequestStatus.APPROVED]: 'rh',
      [LeaveRequestStatus.REJECTED]: 'rejected',
      [LeaveRequestStatus.CANCELLED]: 'cancelled',
    };

    return statusMap[status];
  }

  private toStatusLabel(
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
      [LeaveRequestStatus.IN_REVIEW]: 'Validé manager',
      [LeaveRequestStatus.APPROVED]: 'Confirmé RH',
      [LeaveRequestStatus.REJECTED]: 'Refusé',
      [LeaveRequestStatus.CANCELLED]: 'Annulé',
    };

    return statusMap[status];
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
