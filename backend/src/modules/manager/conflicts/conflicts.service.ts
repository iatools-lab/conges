import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  ConflictSeverity,
  ConflictStatus,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FindManagerConflictsQueryDto,
  UpdateManagerConflictDto,
} from './dto/manager-conflict.dto';

const conflictSelect = {
  id: true,
  requestId: true,
  departmentId: true,
  periodStart: true,
  periodEnd: true,
  severity: true,
  status: true,
  reason: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  request: {
    select: {
      id: true,
      reference: true,
      ownerId: true,
      owner: {
        select: {
          id: true,
          matricule: true,
          nom: true,
          prenom: true,
          poste: true,
          n1Id: true,
          n2Id: true,
          n3Id: true,
          department: { select: { id: true, code: true, name: true } },
        },
      },
      leaveType: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.ConflictSelect;

type ConflictRecord = Prisma.ConflictGetPayload<{
  select: typeof conflictSelect;
}>;

@Injectable()
export class ManagerConflictsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindManagerConflictsQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const year = query.year ?? new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const ownerWhere = this.buildManagedOwnerWhere(manager);
    const scopedDepartments = this.getManagedDepartments(manager);
    const departmentIds = scopedDepartments.map((department) => department.id);

    const rows = await this.prisma.conflict.findMany({
      where: {
        periodStart: { lt: nextYearStart },
        periodEnd: { gte: yearStart },
        OR: [
          { request: { owner: ownerWhere } },
          ...(departmentIds.length
            ? [{ departmentId: { in: departmentIds } }]
            : []),
        ],
      },
      orderBy: [
        { status: 'asc' },
        { severity: 'desc' },
        { periodStart: 'asc' },
      ],
      select: conflictSelect,
    });

    const mappedRows = rows.map((conflict) =>
      this.toResponse(conflict, scopedDepartments),
    );

    return {
      year,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: scopedDepartments,
      },
      rows: mappedRows,
      totals: {
        active: mappedRows.filter((row) => row.state === 'active').length,
        critical: mappedRows.filter(
          (row) => row.state === 'active' && row.severity === 'high',
        ).length,
        watch: mappedRows.filter(
          (row) => row.state === 'active' && row.severity === 'medium',
        ).length,
        resolved: mappedRows.filter((row) => row.state === 'resolved').length,
      },
    };
  }

  async updateStatus(id: string, dto: UpdateManagerConflictDto) {
    const manager = await this.resolveManager(dto.managerId, dto.managerEmail);
    const existing = await this.prisma.conflict.findUnique({
      where: { id },
      select: conflictSelect,
    });

    if (!existing) throw new NotFoundException('Conflit introuvable');
    if (!this.isScopedConflict(manager, existing)) {
      throw new ForbiddenException('Conflit hors périmètre manager');
    }

    const update = this.toConflictUpdate(dto, existing, manager);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const conflict = await transaction.conflict.update({
        where: { id },
        data: update,
        select: conflictSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: manager.id,
          action: AuditAction.UPDATE,
          entity: 'Conflict',
          entityId: id,
          metadata: {
            source: 'manager',
            action: dto.action,
            resolution: update.resolution,
            managerName: this.fullName(manager),
            managerEmail: manager.email,
            requestReference: existing.request?.reference ?? null,
          },
        },
      });

      return conflict;
    });

    return this.toResponse(updated, this.getManagedDepartments(manager));
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

  private isScopedConflict(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
    conflict: ConflictRecord,
  ) {
    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);
    const owner = conflict.request?.owner;
    const ownerDepartment = owner?.department;

    return (
      scopedDepartmentIds.includes(conflict.departmentId ?? '') ||
      (!!owner &&
        owner.id !== manager.id &&
        (scopedDepartmentIds.includes(ownerDepartment?.id ?? '') ||
          owner.n1Id === manager.id))
    );
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

  private toConflictUpdate(
    dto: UpdateManagerConflictDto,
    conflict: ConflictRecord,
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ): Prisma.ConflictUpdateInput {
    const now = new Date();
    if (dto.action === 'resolve') {
      return {
        status: ConflictStatus.RESOLVED,
        resolver: { connect: { id: manager.id } },
        resolvedAt: now,
        resolution: dto.resolution?.trim() || 'Résolu par le manager',
      };
    }

    if (dto.action === 'ignore') {
      return {
        status: ConflictStatus.IGNORED,
        resolver: { connect: { id: manager.id } },
        resolvedAt: now,
        resolution: dto.resolution?.trim() || 'Ignoré par le manager',
      };
    }

    const fallbackPerson =
      this.fullName(conflict.request?.owner) || 'employé concerné';
    const reportPerson = dto.reportPerson?.trim() || fallbackPerson;
    const reportDate = dto.reportDate?.trim();
    if (!reportDate) throw new BadRequestException('Nouvelle période requise');

    return {
      status: ConflictStatus.POSTPONED,
      resolver: { connect: { id: manager.id } },
      resolvedAt: null,
      resolution: `Report proposé à ${reportPerson} → ${reportDate}`,
    };
  }

  private toResponse(
    conflict: ConflictRecord,
    scopedDepartments: Array<{ id: string; code: string; name: string }>,
  ) {
    const owner = conflict.request?.owner;
    const department =
      owner?.department ??
      scopedDepartments.find((item) => item.id === conflict.departmentId) ??
      null;

    return {
      id: conflict.id,
      severity: this.toSeverity(conflict.severity),
      period: this.formatPeriod(conflict.periodStart, conflict.periodEnd),
      periodStart: conflict.periodStart.toISOString(),
      periodEnd: conflict.periodEnd.toISOString(),
      reason: conflict.reason,
      people: owner ? [this.fullName(owner)] : [],
      type: this.toConflictType(conflict),
      state: this.toState(conflict.status),
      resolution: conflict.resolution,
      department,
      request: conflict.request
        ? {
            id: conflict.request.id,
            reference: conflict.request.reference,
            leaveType: conflict.request.leaveType.name,
          }
        : null,
      createdAt: conflict.createdAt.toISOString(),
      resolvedAt: conflict.resolvedAt?.toISOString() ?? null,
    };
  }

  private toConflictType(conflict: ConflictRecord) {
    if (conflict.severity === ConflictSeverity.HIGH)
      return 'Chevauchement majeur';
    if (conflict.request?.leaveType?.name)
      return `Risque de couverture - ${conflict.request.leaveType.name}`;

    return 'Risque de couverture';
  }

  private toSeverity(severity: ConflictSeverity) {
    const map: Record<ConflictSeverity, 'high' | 'medium' | 'low'> = {
      [ConflictSeverity.HIGH]: 'high',
      [ConflictSeverity.MEDIUM]: 'medium',
      [ConflictSeverity.LOW]: 'low',
    };

    return map[severity];
  }

  private toState(status: ConflictStatus) {
    const map: Record<
      ConflictStatus,
      'active' | 'resolved' | 'ignored' | 'report'
    > = {
      [ConflictStatus.ACTIVE]: 'active',
      [ConflictStatus.RESOLVED]: 'resolved',
      [ConflictStatus.IGNORED]: 'ignored',
      [ConflictStatus.POSTPONED]: 'report',
    };

    return map[status];
  }

  private formatPeriod(start: Date, end: Date) {
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    if (start.toDateString() === end.toDateString())
      return formatter.format(start);

    return `${formatter.format(start)} → ${formatter.format(end)}`;
  }

  private fullName(user?: { nom: string; prenom: string } | null) {
    if (!user) return '';
    return `${user.prenom} ${user.nom}`.trim();
  }
}
