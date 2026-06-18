import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindManagerHistoryQueryDto } from './dto/manager-history.dto';
import { fieldDateWhere, resolveDateRange } from '../../../common/date-range';

const validationSelect = {
  id: true,
  decision: true,
  comment: true,
  decidedAt: true,
  validator: {
    select: {
      id: true,
      nom: true,
      prenom: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
  request: {
    select: {
      id: true,
      reference: true,
      startDate: true,
      endDate: true,
      days: true,
      submittedAt: true,
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
      leaveType: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.ValidationSelect;

type ValidationRecord = Prisma.ValidationGetPayload<{
  select: typeof validationSelect;
}>;

@Injectable()
export class ManagerHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindManagerHistoryQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const now = new Date();
    const range = resolveDateRange(query, { defaultMode: 'year', now });
    const year = range.year;
    const decidedAt = fieldDateWhere(range);

    const validations = await this.prisma.validation.findMany({
      where: {
        ...(decidedAt ? { decidedAt } : {}),
        request: { owner: this.buildManagedOwnerWhere(manager) },
      },
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
      select: validationSelect,
    });

    const rows = validations.map((validation) => this.toRow(validation));
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const delays = validations
      .map((validation) => this.delayDays(validation))
      .filter((value): value is number => value !== null);

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: this.getManagedDepartments(manager),
      },
      rows,
      totals: {
        month: validations.filter(
          (validation) =>
            validation.decidedAt >= monthStart &&
            validation.decidedAt < nextMonthStart,
        ).length,
        valid: rows.filter((row) => row.decision === 'valid').length,
        rejected: rows.filter((row) => row.decision === 'rejected').length,
        pending: rows.filter((row) => row.decision === 'pending').length,
        averageDelay: delays.length
          ? Math.round(
              (delays.reduce((sum, value) => sum + value, 0) / delays.length) *
                10,
            ) / 10
          : 0,
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

  private toRow(validation: ValidationRecord) {
    return {
      id: validation.id,
      date: validation.decidedAt.toISOString(),
      emp: this.fullName(validation.request.owner),
      matricule: validation.request.owner.matricule,
      department: validation.request.owner.department,
      validator: this.fullName(validation.validator),
      validatorDepartment: validation.validator.department,
      type: validation.request.leaveType.name,
      period: `${this.formatDate(validation.request.startDate)} → ${this.formatDate(validation.request.endDate)}`,
      days: Math.round(validation.request.days * 10) / 10,
      decision: this.toDecision(validation.decision),
      note: validation.comment?.trim() || '—',
      reference: validation.request.reference,
      requestId: validation.request.id,
    };
  }

  private toDecision(decision: ValidationDecision) {
    const map: Record<ValidationDecision, 'valid' | 'rejected' | 'pending'> = {
      [ValidationDecision.APPROVED]: 'valid',
      [ValidationDecision.REJECTED]: 'rejected',
      [ValidationDecision.REVIEW_REQUESTED]: 'pending',
    };

    return map[decision];
  }

  private delayDays(validation: ValidationRecord) {
    if (!validation.request.submittedAt) return null;
    const diff =
      validation.decidedAt.getTime() - validation.request.submittedAt.getTime();

    return Math.max(0, diff / 86_400_000);
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }
}
