import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  LeaveRequestStatus,
  NotificationType,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import {
  CreateEmployeePermissionDto,
  DecideManagerPermissionDto,
  DecideRhPermissionDto,
  FindEmployeePermissionsQueryDto,
  FindManagerPermissionsQueryDto,
  FindRhPermissionsQueryDto,
  ManagerPermissionDecision,
  RhPermissionDecision,
  UpdateEmployeePermissionDto,
} from './dto/permission-request.dto';

const PERMISSION_QUOTA_PER_YEAR = 5;
const ACTIVE_PERMISSION_STATUSES = [
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.APPROVED,
] as const;

const permissionSelect = {
  id: true,
  reference: true,
  ownerId: true,
  permissionDate: true,
  reason: true,
  status: true,
  submittedAt: true,
  managerComment: true,
  managerDecidedAt: true,
  rhComment: true,
  rhDecidedAt: true,
  cancelledAt: true,
  createdAt: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      email: true,
      n1Id: true,
      department: {
        select: {
          id: true,
          code: true,
          name: true,
          managerId: true,
        },
      },
      n1: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          poste: true,
        },
      },
    },
  },
  managerValidator: {
    select: { id: true, nom: true, prenom: true, email: true },
  },
  rhValidator: {
    select: { id: true, nom: true, prenom: true, email: true },
  },
} satisfies Prisma.PermissionRequestSelect;

type PermissionRow = Prisma.PermissionRequestGetPayload<{
  select: typeof permissionSelect;
}>;
type PrismaClientLike = PrismaService | Prisma.TransactionClient;
type EmailMessage = Parameters<EmailService['sendMany']>[0][number];

@Injectable()
export class PermissionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async findEmployee(query: FindEmployeePermissionsQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const year = query.year ?? new Date().getUTCFullYear();
    const rows = await this.prisma.permissionRequest.findMany({
      where: {
        ownerId: user.id,
        permissionDate: this.yearDateWhere(year),
      },
      orderBy: [{ permissionDate: 'desc' }, { createdAt: 'desc' }],
      select: permissionSelect,
    });
    const responseRows = rows.map((row) => this.toResponse(row));

    return {
      year,
      quota: PERMISSION_QUOTA_PER_YEAR,
      rows: responseRows,
      totals: this.buildTotals(responseRows),
    };
  }

  async createEmployee(dto: CreateEmployeePermissionDto) {
    const user = await this.resolveUserWithHierarchy(dto.userId, dto.userEmail);
    if (!user.n1Id || !user.n1) {
      throw new BadRequestException(
        'Aucun N+1 n’est configure sur votre profil. Contactez la RH avant de demander une permission.',
      );
    }

    const permissionDate = this.parseDate(dto.permissionDate);
    const reason = dto.reason?.trim() || null;
    const created = await this.prisma.$transaction(async (transaction) => {
      await this.ensureCanReservePermission(
        transaction,
        user.id,
        permissionDate,
      );

      const permission = await transaction.permissionRequest.create({
        data: {
          reference: await this.generateReference(transaction, permissionDate),
          ownerId: user.id,
          permissionDate,
          reason,
          status: LeaveRequestStatus.PENDING,
          submittedAt: new Date(),
        },
        select: permissionSelect,
      });

      await transaction.notification.create({
        data: {
          userId: user.n1Id!,
          type: NotificationType.REQUEST_SUBMITTED,
          title: 'Nouvelle demande de permission',
          description: `${permission.reference} — ${this.fullName(permission.owner)}`,
          link: '/manager/permissions',
        },
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.CREATE,
          entity: 'PermissionRequest',
          entityId: permission.id,
          metadata: {
            source: 'employee',
            reference: permission.reference,
            permissionDate: this.toInputDate(permissionDate),
          },
        },
      });

      return permission;
    });

    await this.sendEmails([
      {
        to: user.n1.email,
        subject: `Permission a valider — ${created.reference}`,
        text: `${this.fullName(user)} a soumis une demande de permission pour le ${this.formatDate(created.permissionDate)}. Reference : ${created.reference}.`,
        link: '/manager/permissions',
        actionLabel: 'Valider la permission',
      },
    ]);

    return this.toResponse(created);
  }

  async updateEmployee(id: string, dto: UpdateEmployeePermissionDto) {
    const user = await this.resolveUserWithHierarchy(dto.userId, dto.userEmail);
    if (!user.n1Id || !user.n1) {
      throw new BadRequestException(
        'Aucun N+1 n’est configure sur votre profil. Contactez la RH avant de modifier cette permission.',
      );
    }

    const existing = await this.prisma.permissionRequest.findUnique({
      where: { id },
      select: permissionSelect,
    });

    if (!existing || existing.ownerId !== user.id) {
      throw new NotFoundException('Permission introuvable');
    }

    if (
      existing.status !== LeaveRequestStatus.PENDING &&
      existing.status !== LeaveRequestStatus.REJECTED
    ) {
      throw new ForbiddenException(
        'Cette permission ne peut plus etre modifiee.',
      );
    }

    const permissionDate = dto.permissionDate
      ? this.parseDate(dto.permissionDate)
      : existing.permissionDate;
    const reason =
      dto.reason !== undefined ? dto.reason.trim() || null : existing.reason;

    const updated = await this.prisma.$transaction(async (transaction) => {
      await this.ensureCanReservePermission(
        transaction,
        user.id,
        permissionDate,
        existing.id,
      );

      const permission = await transaction.permissionRequest.update({
        where: { id: existing.id },
        data: {
          permissionDate,
          reason,
          status: LeaveRequestStatus.PENDING,
          submittedAt: new Date(),
          managerValidatorId: null,
          managerComment: null,
          managerDecidedAt: null,
          rhValidatorId: null,
          rhComment: null,
          rhDecidedAt: null,
          cancelledAt: null,
        },
        select: permissionSelect,
      });

      await transaction.notification.create({
        data: {
          userId: user.n1Id!,
          type: NotificationType.REQUEST_SUBMITTED,
          title: 'Permission modifiee a valider',
          description: `${permission.reference} — ${this.fullName(permission.owner)}`,
          link: '/manager/permissions',
        },
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.UPDATE,
          entity: 'PermissionRequest',
          entityId: permission.id,
          metadata: {
            source: 'employee',
            reference: permission.reference,
            action: 'resubmit',
            previousDate: this.toInputDate(existing.permissionDate),
            newDate: this.toInputDate(permission.permissionDate),
          },
        },
      });

      return permission;
    });

    await this.sendEmails([
      {
        to: user.n1.email,
        subject: `Permission modifiee a valider — ${updated.reference}`,
        text: `${this.fullName(user)} a modifie sa demande de permission pour le ${this.formatDate(updated.permissionDate)}. Reference : ${updated.reference}.`,
        link: '/manager/permissions',
        actionLabel: 'Valider la permission',
      },
    ]);

    return this.toResponse(updated);
  }

  async cancelEmployee(
    id: string,
    dto: { userId?: string; userEmail?: string },
  ) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.prisma.permissionRequest.findUnique({
      where: { id },
      select: permissionSelect,
    });

    if (!existing || existing.ownerId !== user.id) {
      throw new NotFoundException('Permission introuvable');
    }

    if (existing.status === LeaveRequestStatus.APPROVED) {
      throw new ForbiddenException(
        'Une permission approuvee ne peut pas etre annulee depuis votre espace.',
      );
    }

    if (existing.status === LeaveRequestStatus.CANCELLED) {
      return this.toResponse(existing);
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const permission = await transaction.permissionRequest.update({
        where: { id: existing.id },
        data: {
          status: LeaveRequestStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        select: permissionSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.UPDATE,
          entity: 'PermissionRequest',
          entityId: permission.id,
          metadata: {
            source: 'employee',
            reference: permission.reference,
            action: 'cancel',
          },
        },
      });

      return permission;
    });

    return this.toResponse(updated);
  }

  async findManager(query: FindManagerPermissionsQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const year = query.year ?? new Date().getUTCFullYear();
    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);
    const rows = await this.prisma.permissionRequest.findMany({
      where: {
        permissionDate: this.yearDateWhere(year),
        owner: {
          id: { not: manager.id },
          status: { not: UserStatus.INACTIVE },
          OR: [
            { n1Id: manager.id },
            ...(scopedDepartmentIds.length
              ? [{ departmentId: { in: scopedDepartmentIds } }]
              : []),
          ],
        },
      },
      orderBy: [{ status: 'asc' }, { permissionDate: 'desc' }],
      select: permissionSelect,
    });
    const responseRows = rows.map((row) =>
      this.toResponse(row, row.owner.n1Id === manager.id),
    );

    return {
      year,
      quota: PERMISSION_QUOTA_PER_YEAR,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: manager.managedDepartments,
      },
      rows: responseRows,
      totals: this.buildTotals(responseRows),
    };
  }

  async decideManager(id: string, dto: DecideManagerPermissionDto) {
    const manager = await this.resolveManager(dto.managerId, dto.managerEmail);
    const comment = dto.comment?.trim();
    if (dto.decision === 'reject' && !comment) {
      throw new BadRequestException(
        'Un commentaire est requis pour refuser la permission.',
      );
    }

    const existing = await this.prisma.permissionRequest.findUnique({
      where: { id },
      select: permissionSelect,
    });

    if (!existing) throw new NotFoundException('Permission introuvable');
    if (existing.owner.n1Id !== manager.id) {
      throw new ForbiddenException(
        'Seul le N+1 de l’employe peut traiter cette permission.',
      );
    }

    const transition = this.managerTransition(dto.decision);
    if (existing.status !== LeaveRequestStatus.PENDING) {
      const alreadyApplied =
        existing.managerValidator?.id === manager.id &&
        existing.status === transition.status;
      if (alreadyApplied) return this.toResponse(existing, false);

      throw new BadRequestException('Cette permission est deja traitee.');
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.permissionRequest.updateMany({
        where: { id: existing.id, status: LeaveRequestStatus.PENDING },
        data: {
          status: transition.status,
          managerValidatorId: manager.id,
          managerComment: comment || null,
          managerDecidedAt: new Date(),
          rhValidatorId:
            transition.status === LeaveRequestStatus.REJECTED
              ? null
              : undefined,
          rhComment:
            transition.status === LeaveRequestStatus.REJECTED
              ? null
              : undefined,
          rhDecidedAt:
            transition.status === LeaveRequestStatus.REJECTED
              ? null
              : undefined,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'Cette permission a deja ete traitee par un autre processus.',
        );
      }

      const permission = await transaction.permissionRequest.findUniqueOrThrow({
        where: { id: existing.id },
        select: permissionSelect,
      });

      const notifications = [
        {
          userId: permission.ownerId,
          type:
            transition.status === LeaveRequestStatus.IN_REVIEW
              ? NotificationType.REQUEST_REVIEW
              : NotificationType.REQUEST_REJECTED,
          title:
            transition.status === LeaveRequestStatus.IN_REVIEW
              ? 'Permission transmise a la RH'
              : 'Permission refusee par le N+1',
          description: `${permission.reference} — ${this.formatDate(permission.permissionDate)}`,
          link: '/permissions',
        },
      ];
      const emails: EmailMessage[] = [
        {
          to: permission.owner.email,
          subject:
            transition.status === LeaveRequestStatus.IN_REVIEW
              ? `Permission transmise RH — ${permission.reference}`
              : `Permission refusee — ${permission.reference}`,
          text:
            transition.status === LeaveRequestStatus.IN_REVIEW
              ? `Votre permission ${permission.reference} du ${this.formatDate(permission.permissionDate)} a ete validee par votre N+1 et transmise a la RH.`
              : `Votre permission ${permission.reference} du ${this.formatDate(permission.permissionDate)} a ete refusee par votre N+1.${comment ? ` Motif : ${comment}` : ''}`,
          link: '/permissions',
          actionLabel: 'Consulter ma permission',
        },
      ];

      if (transition.status === LeaveRequestStatus.IN_REVIEW) {
        const rhUsers = await transaction.user.findMany({
          where: {
            status: { not: UserStatus.INACTIVE },
            roles: { some: { role: { in: [RoleType.RH, RoleType.ADMIN] } } },
          },
          select: { id: true, email: true },
        });

        notifications.push(
          ...rhUsers.map((rhUser) => ({
            userId: rhUser.id,
            type: NotificationType.REQUEST_REVIEW,
            title: 'Permission a valider RH',
            description: `${permission.reference} — ${this.fullName(permission.owner)}`,
            link: '/rh/permissions',
          })),
        );
        emails.push(
          ...rhUsers.map((rhUser) => ({
            to: rhUser.email,
            subject: `Permission a valider RH — ${permission.reference}`,
            text: `La permission ${permission.reference} de ${this.fullName(permission.owner)} pour le ${this.formatDate(permission.permissionDate)} est en attente de validation RH.`,
            link: '/rh/permissions',
            actionLabel: 'Valider la permission',
          })),
        );
      }

      await transaction.notification.createMany({ data: notifications });
      await transaction.auditLog.create({
        data: {
          userId: manager.id,
          action: transition.auditAction,
          entity: 'PermissionRequest',
          entityId: permission.id,
          metadata: {
            source: 'manager',
            decision: dto.decision,
            reference: permission.reference,
            comment: comment || null,
          },
        },
      });

      return { permission, emails };
    });

    await this.sendEmails(result.emails);

    return this.toResponse(result.permission, false);
  }

  async findRh(query: FindRhPermissionsQueryDto) {
    const year = query.year ?? new Date().getUTCFullYear();
    const departmentCode = query.department?.trim().toUpperCase() || null;
    const where: Prisma.PermissionRequestWhereInput = {
      permissionDate: this.yearDateWhere(year),
      owner: {
        status: { not: UserStatus.INACTIVE },
        ...(departmentCode
          ? { department: { is: { code: departmentCode } } }
          : {}),
      },
    };
    const [rows, departments] = await Promise.all([
      this.prisma.permissionRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { permissionDate: 'desc' }],
        select: permissionSelect,
      }),
      this.prisma.department.findMany({
        orderBy: [{ name: 'asc' }],
        select: { code: true, name: true },
      }),
    ]);
    const responseRows = rows.map((row) => this.toResponse(row));

    return {
      year,
      quota: PERMISSION_QUOTA_PER_YEAR,
      departments,
      rows: responseRows,
      totals: this.buildTotals(responseRows),
      byDepartment: this.buildByDepartment(responseRows),
    };
  }

  async decideRh(id: string, dto: DecideRhPermissionDto) {
    const rh = await this.resolveRh(dto.rhId, dto.rhEmail);
    const comment = dto.comment?.trim();
    if (dto.decision === 'reject' && !comment) {
      throw new BadRequestException(
        'Un commentaire est requis pour refuser la permission.',
      );
    }

    const existing = await this.prisma.permissionRequest.findUnique({
      where: { id },
      select: permissionSelect,
    });

    if (!existing) throw new NotFoundException('Permission introuvable');
    const transition = this.rhTransition(dto.decision);

    if (existing.status !== LeaveRequestStatus.IN_REVIEW) {
      const alreadyApplied =
        existing.rhValidator?.id === rh.id && existing.status === transition;
      if (alreadyApplied) return this.toResponse(existing);

      throw new BadRequestException(
        'La permission doit etre validee par le N+1 avant decision RH.',
      );
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.permissionRequest.updateMany({
        where: { id: existing.id, status: LeaveRequestStatus.IN_REVIEW },
        data: {
          status: transition,
          rhValidatorId: rh.id,
          rhComment: comment || null,
          rhDecidedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'Cette permission a deja ete traitee par un autre processus.',
        );
      }

      const permission = await transaction.permissionRequest.findUniqueOrThrow({
        where: { id: existing.id },
        select: permissionSelect,
      });
      const approved = permission.status === LeaveRequestStatus.APPROVED;
      const recipientIds = Array.from(
        new Set(
          [permission.ownerId, permission.managerValidator?.id].filter(Boolean),
        ),
      ) as string[];

      if (recipientIds.length > 0) {
        await transaction.notification.createMany({
          data: recipientIds.map((userId) => ({
            userId,
            type: approved
              ? NotificationType.REQUEST_APPROVED
              : NotificationType.REQUEST_REJECTED,
            title: approved
              ? 'Permission approuvee par RH'
              : 'Permission refusee par RH',
            description: `${permission.reference} — ${this.formatDate(permission.permissionDate)}`,
            link:
              userId === permission.ownerId
                ? '/permissions'
                : '/manager/permissions',
          })),
        });
      }

      await transaction.auditLog.create({
        data: {
          userId: rh.id,
          action: approved ? AuditAction.APPROVE : AuditAction.REJECT,
          entity: 'PermissionRequest',
          entityId: permission.id,
          metadata: {
            source: 'rh',
            decision: dto.decision,
            reference: permission.reference,
            comment: comment || null,
          },
        },
      });

      const emails: EmailMessage[] = [
        {
          to: permission.owner.email,
          subject: approved
            ? `Permission approuvee — ${permission.reference}`
            : `Permission refusee — ${permission.reference}`,
          text: approved
            ? `Votre permission ${permission.reference} du ${this.formatDate(permission.permissionDate)} a ete approuvee par la RH.`
            : `Votre permission ${permission.reference} du ${this.formatDate(permission.permissionDate)} a ete refusee par la RH.${comment ? ` Motif : ${comment}` : ''}`,
          link: '/permissions',
          actionLabel: 'Consulter ma permission',
        },
      ];
      if (permission.managerValidator?.email) {
        emails.push({
          to: permission.managerValidator.email,
          subject: approved
            ? `Permission approuvee RH — ${permission.reference}`
            : `Permission refusee RH — ${permission.reference}`,
          text: approved
            ? `La permission ${permission.reference} de ${this.fullName(permission.owner)} a ete approuvee par la RH.`
            : `La permission ${permission.reference} de ${this.fullName(permission.owner)} a ete refusee par la RH.`,
          link: '/manager/permissions',
          actionLabel: 'Voir la permission',
        });
      }

      return { permission, emails };
    });

    await this.sendEmails(result.emails);

    return this.toResponse(result.permission);
  }

  private async ensureCanReservePermission(
    client: PrismaClientLike,
    ownerId: string,
    permissionDate: Date,
    excludeId?: string,
  ) {
    const year = permissionDate.getUTCFullYear();
    const whereExclude = excludeId ? { id: { not: excludeId } } : {};
    const [activeCount, sameDay] = await Promise.all([
      client.permissionRequest.count({
        where: {
          ownerId,
          ...whereExclude,
          status: { in: [...ACTIVE_PERMISSION_STATUSES] },
          permissionDate: this.yearDateWhere(year),
        },
      }),
      client.permissionRequest.findFirst({
        where: {
          ownerId,
          ...whereExclude,
          status: { in: [...ACTIVE_PERMISSION_STATUSES] },
          permissionDate,
        },
        select: { reference: true },
      }),
    ]);

    if (sameDay) {
      throw new BadRequestException(
        `Une permission existe deja pour cette date (${sameDay.reference}).`,
      );
    }

    if (activeCount >= PERMISSION_QUOTA_PER_YEAR) {
      throw new BadRequestException(
        `Quota annuel atteint: ${PERMISSION_QUOTA_PER_YEAR} permissions maximum par an.`,
      );
    }
  }

  private async resolveUser(userId?: string, userEmail?: string) {
    const where = userId?.trim()
      ? { id: userId.trim() }
      : userEmail?.trim()
        ? { email: userEmail.trim().toLowerCase() }
        : null;
    if (!where) throw new BadRequestException('Utilisateur requis');

    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        matricule: true,
        nom: true,
        prenom: true,
        status: true,
      },
    });
    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private async resolveUserWithHierarchy(userId?: string, userEmail?: string) {
    const where = userId?.trim()
      ? { id: userId.trim() }
      : userEmail?.trim()
        ? { email: userEmail.trim().toLowerCase() }
        : null;
    if (!where) throw new BadRequestException('Utilisateur requis');

    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        matricule: true,
        nom: true,
        prenom: true,
        status: true,
        n1Id: true,
        n1: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            poste: true,
          },
        },
      },
    });
    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
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
        roles: { select: { role: true } },
      },
    });
    if (!manager || manager.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Manager introuvable');
    }

    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);
    const hasManagerRole = manager.roles.some(
      (role) => role.role === RoleType.MANAGER || role.role === RoleType.ADMIN,
    );
    if (!hasManagerRole && scopedDepartmentIds.length === 0) {
      throw new ForbiddenException('Utilisateur sans equipe sous autorite');
    }

    return manager;
  }

  private async resolveRh(rhId?: string, rhEmail?: string) {
    const where = rhId?.trim()
      ? { id: rhId.trim() }
      : rhEmail?.trim()
        ? { email: rhEmail.trim().toLowerCase() }
        : null;
    if (!where) throw new BadRequestException('RH requise');

    const rh = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        status: true,
        roles: { select: { role: true } },
      },
    });
    if (!rh || rh.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur RH introuvable');
    }
    if (
      !rh.roles.some(
        (role) => role.role === RoleType.RH || role.role === RoleType.ADMIN,
      )
    ) {
      throw new ForbiddenException(
        'Seul un utilisateur RH peut traiter cette permission.',
      );
    }

    return rh;
  }

  private managerTransition(decision: ManagerPermissionDecision) {
    if (decision === 'approve') {
      return {
        status: LeaveRequestStatus.IN_REVIEW,
        auditAction: AuditAction.APPROVE,
      };
    }

    return {
      status: LeaveRequestStatus.REJECTED,
      auditAction: AuditAction.REJECT,
    };
  }

  private rhTransition(decision: RhPermissionDecision) {
    return decision === 'approve'
      ? LeaveRequestStatus.APPROVED
      : LeaveRequestStatus.REJECTED;
  }

  private toResponse(row: PermissionRow, canDecide = false) {
    const status = this.toStatus(row.status);

    return {
      id: row.id,
      reference: row.reference,
      employeeId: row.owner.id,
      employeeName: this.fullName(row.owner),
      matricule: row.owner.matricule,
      departmentCode: row.owner.department?.code ?? 'NA',
      department: row.owner.department?.name ?? 'Sans departement',
      permissionDate: this.toInputDate(row.permissionDate),
      permissionDateLabel: this.formatDate(row.permissionDate),
      days: 1,
      reason: row.reason?.trim() || '',
      statusCode: row.status,
      status: status.tone,
      statusLabel: status.label,
      submittedAt: row.submittedAt.toISOString(),
      submittedDate: this.formatDate(row.submittedAt),
      managerName: row.managerValidator
        ? this.fullName(row.managerValidator)
        : row.owner.n1
          ? this.fullName(row.owner.n1)
          : null,
      rhName: row.rhValidator ? this.fullName(row.rhValidator) : null,
      managerComment: row.managerComment?.trim() || '',
      rhComment: row.rhComment?.trim() || '',
      managerDecidedAt: row.managerDecidedAt?.toISOString() ?? null,
      rhDecidedAt: row.rhDecidedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      canDecide,
    };
  }

  private buildTotals(
    rows: Array<{
      statusCode: LeaveRequestStatus;
      departmentCode?: string;
      department?: string;
    }>,
  ) {
    const active = rows.filter((row) =>
      ACTIVE_PERMISSION_STATUSES.includes(
        row.statusCode as (typeof ACTIVE_PERMISSION_STATUSES)[number],
      ),
    ).length;

    return {
      total: rows.length,
      quota: PERMISSION_QUOTA_PER_YEAR,
      pendingManager: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.PENDING,
      ).length,
      pendingRh: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.IN_REVIEW,
      ).length,
      approved: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.APPROVED,
      ).length,
      rejected: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.REJECTED,
      ).length,
      cancelled: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.CANCELLED,
      ).length,
      active,
      remaining: Math.max(0, PERMISSION_QUOTA_PER_YEAR - active),
    };
  }

  private buildByDepartment(
    rows: ReturnType<PermissionRequestsService['toResponse']>[],
  ) {
    const grouped = new Map<
      string,
      {
        departmentCode: string;
        departmentName: string;
        total: number;
        approved: number;
      }
    >();

    for (const row of rows) {
      const current = grouped.get(row.departmentCode) ?? {
        departmentCode: row.departmentCode,
        departmentName: row.department,
        total: 0,
        approved: 0,
      };
      current.total += 1;
      if (row.statusCode === LeaveRequestStatus.APPROVED) {
        current.approved += 1;
      }
      grouped.set(row.departmentCode, current);
    }

    return Array.from(grouped.values()).sort((left, right) =>
      left.departmentName.localeCompare(right.departmentName),
    );
  }

  private toStatus(status: LeaveRequestStatus) {
    const map: Record<
      LeaveRequestStatus,
      {
        tone: 'pending' | 'valid' | 'rejected' | 'neutral' | 'review';
        label: string;
      }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'neutral', label: 'Brouillon' },
      [LeaveRequestStatus.PENDING]: {
        tone: 'pending',
        label: 'En attente N+1',
      },
      [LeaveRequestStatus.IN_REVIEW]: {
        tone: 'review',
        label: 'En attente RH',
      },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Approuvee' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusee' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulee' },
    };

    return map[status];
  }

  private async generateReference(
    client: Prisma.TransactionClient,
    permissionDate: Date,
  ) {
    const year = permissionDate.getUTCFullYear();
    const count = await client.permissionRequest.count({
      where: { reference: { startsWith: `PERM-${year}-` } },
    });

    return `PERM-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private getScopedDepartmentIds(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
  ) {
    return Array.from(
      new Set(manager.managedDepartments.map((department) => department.id)),
    );
  }

  private yearDateWhere(year: number) {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Annee invalide');
    }

    return {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }

  private parseDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date invalide');
    }

    return date;
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(value);
  }

  private toInputDate(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private async sendEmails(messages: EmailMessage[]) {
    const uniqueMessages = Array.from(
      new Map(
        messages
          .filter((message) => this.normalizeEmail(message.to))
          .map((message) => [
            `${this.normalizeEmail(message.to)}:${message.subject}:${message.link ?? ''}`,
            { ...message, to: this.normalizeEmail(message.to)! },
          ]),
      ).values(),
    );
    if (uniqueMessages.length > 0) {
      await this.emailService.sendMany(uniqueMessages);
    }
  }

  private normalizeEmail(value: string | null | undefined) {
    const normalized = value?.trim().toLowerCase();
    return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
      ? normalized
      : null;
  }
}
