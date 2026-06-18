import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  OvertimeStatus,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../shared/notifications/email.service';
import {
  DecideManagerOvertimeDto,
  FindManagerOvertimeQueryDto,
  ManagerOvertimeDecision,
} from './dto/manager-overtime.dto';

const overtimeSelect = {
  id: true,
  reference: true,
  ownerId: true,
  workDate: true,
  hours: true,
  reason: true,
  status: true,
  submittedAt: true,
  managerComment: true,
  managerDecidedAt: true,
  rhComment: true,
  rhDecidedAt: true,
  cancelledAt: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      n1Id: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
  managerValidator: { select: { id: true, nom: true, prenom: true } },
  rhValidator: { select: { id: true, nom: true, prenom: true } },
} satisfies Prisma.OvertimeRequestSelect;

type OvertimeRow = Prisma.OvertimeRequestGetPayload<{
  select: typeof overtimeSelect;
}>;

@Injectable()
export class ManagerOvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(query: FindManagerOvertimeQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const year = query.year ?? new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const scopedDepartmentIds = this.getScopedDepartmentIds(manager);

    const rows = await this.prisma.overtimeRequest.findMany({
      where: {
        workDate: { gte: yearStart, lt: nextYearStart },
        owner: {
          id: { not: manager.id },
          status: { not: UserStatus.INACTIVE },
          OR: [
            { departmentId: { in: scopedDepartmentIds } },
            { n1Id: manager.id },
            { n2Id: manager.id },
            { n3Id: manager.id },
          ],
        },
      },
      orderBy: [{ status: 'asc' }, { workDate: 'desc' }],
      select: overtimeSelect,
    });

    const responseRows = rows.map((row) =>
      this.toResponse(row, this.canDecide(manager, row)),
    );

    return {
      year,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: manager.managedDepartments,
      },
      rows: responseRows,
      totals: {
        total: responseRows.length,
        pendingManager: responseRows.filter(
          (row) => row.statusCode === 'PENDING_MANAGER',
        ).length,
        pendingRh: responseRows.filter(
          (row) => row.statusCode === 'IN_REVIEW_RH',
        ).length,
        approved: responseRows.filter((row) => row.statusCode === 'APPROVED')
          .length,
        rejected: responseRows.filter((row) => row.statusCode === 'REJECTED')
          .length,
        approvedHours: this.roundHours(
          responseRows
            .filter((row) => row.statusCode === 'APPROVED')
            .reduce((sum, row) => sum + row.hours, 0),
        ),
      },
    };
  }

  async decide(id: string, dto: DecideManagerOvertimeDto) {
    const manager = await this.resolveManager(dto.managerId, dto.managerEmail);
    const comment = dto.comment?.trim();
    if (dto.decision === 'reject' && !comment) {
      throw new BadRequestException(
        'Un commentaire est requis pour refuser la déclaration',
      );
    }

    const existing = await this.prisma.overtimeRequest.findUnique({
      where: { id },
      select: overtimeSelect,
    });

    if (!existing) throw new NotFoundException('Déclaration introuvable');
    if (!this.canDecide(manager, existing)) {
      throw new ForbiddenException('Déclaration hors périmètre manager');
    }

    if (existing.status !== OvertimeStatus.PENDING_MANAGER) {
      throw new BadRequestException('Cette déclaration est déjà traitée');
    }

    const transition = this.transition(dto.decision);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (transaction) => {
      const overtime = await transaction.overtimeRequest.update({
        where: { id },
        data: {
          status: transition.status,
          managerValidatorId: manager.id,
          managerComment: comment || null,
          managerDecidedAt: now,
          rhComment:
            transition.status === OvertimeStatus.REJECTED ? null : undefined,
          rhDecidedAt:
            transition.status === OvertimeStatus.REJECTED ? null : undefined,
          rhValidatorId:
            transition.status === OvertimeStatus.REJECTED ? null : undefined,
        },
        select: overtimeSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: manager.id,
          action: transition.auditAction,
          entity: 'OvertimeRequest',
          entityId: overtime.id,
          metadata: {
            source: 'manager',
            decision: dto.decision,
            reference: overtime.reference,
            comment: comment || null,
          },
        },
      });

      const notificationData = [
        {
          userId: overtime.ownerId,
          type:
            transition.status === OvertimeStatus.IN_REVIEW_RH
              ? NotificationType.REQUEST_REVIEW
              : NotificationType.REQUEST_REJECTED,
          title:
            transition.status === OvertimeStatus.IN_REVIEW_RH
              ? 'Heure supplémentaire transmise RH'
              : 'Heure supplémentaire refusée par le manager',
          description: `${overtime.reference} — ${this.fullName(overtime.owner)}`,
          link: '/heures-supp',
        },
      ];

      if (transition.status === OvertimeStatus.IN_REVIEW_RH) {
        const rhUsers = await transaction.user.findMany({
          where: {
            status: { not: UserStatus.INACTIVE },
            roles: { some: { role: RoleType.RH } },
          },
          select: { id: true },
        });

        notificationData.push(
          ...rhUsers.map((rhUser) => ({
            userId: rhUser.id,
            type: NotificationType.REQUEST_REVIEW,
            title: 'Heure supplémentaire à valider',
            description: `${overtime.reference} — ${this.fullName(overtime.owner)}`,
            link: '/rh/heures-supp',
          })),
        );
      }

      await transaction.notification.createMany({ data: notificationData });

      return overtime;
    });

    // Email employee
    const employeeUser = await this.prisma.user.findUnique({
      where: { id: updated.ownerId },
      select: { email: true },
    });
    if (employeeUser?.email) {
      const isApproved = updated.status === OvertimeStatus.IN_REVIEW_RH;
      await this.emailService.send({
        to: employeeUser.email,
        link: '/heures-supp',
        actionLabel: 'Consulter ma declaration',
        subject: isApproved
          ? `Déclaration HS transmise RH — ${updated.reference}`
          : `Déclaration HS refusée — ${updated.reference}`,
        text: isApproved
          ? `Votre déclaration ${updated.reference} a été validée par votre manager et transmise à la RH pour validation finale.`
          : `Votre déclaration ${updated.reference} a été refusée par votre manager.${updated.managerComment ? ` Motif : ${updated.managerComment}` : ''}`,
      });
    }

    // Email RH if forwarded
    if (updated.status === OvertimeStatus.IN_REVIEW_RH) {
      const rhUsers = await this.prisma.user.findMany({
        where: {
          status: { not: UserStatus.INACTIVE },
          roles: { some: { role: RoleType.RH } },
        },
        select: { email: true },
      });
      const rhEmails = rhUsers
        .map((u) => u.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e));
      if (rhEmails.length > 0) {
        await this.emailService.sendMany(
          rhEmails.map((to) => ({
            to,
            link: '/rh/heures-supp',
            actionLabel: 'Valider les heures supplementaires',
            subject: `HS à valider RH — ${updated.reference}`,
            text: `La déclaration d'heure supplémentaire ${updated.reference} de ${this.fullName(updated.owner)} (${this.roundHours(updated.hours)} h) est en attente de validation RH.`,
          })),
        );
      }
    }

    return this.toResponse(updated, false);
  }

  private transition(decision: ManagerOvertimeDecision) {
    if (decision === 'approve') {
      return {
        status: OvertimeStatus.IN_REVIEW_RH,
        auditAction: AuditAction.APPROVE,
      };
    }

    return {
      status: OvertimeStatus.REJECTED,
      auditAction: AuditAction.REJECT,
    };
  }

  private canDecide(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
    row: OvertimeRow,
  ) {
    if (row.ownerId === manager.id) return false;
    return row.owner.n1Id === manager.id;
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
      (role) => role.role === RoleType.MANAGER,
    );

    if (!hasManagerRole && scopedDepartmentIds.length === 0) {
      throw new ForbiddenException('Utilisateur sans equipe sous autorite');
    }

    return manager;
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

  private toResponse(row: OvertimeRow, canDecide: boolean) {
    const status = this.toStatus(row.status);

    return {
      id: row.id,
      reference: row.reference,
      employeeId: row.owner.id,
      employeeName: this.fullName(row.owner),
      matricule: row.owner.matricule,
      department: row.owner.department?.name ?? 'Sans département',
      workDate: this.toInputDate(row.workDate),
      workDateLabel: this.formatDate(row.workDate),
      hours: this.roundHours(row.hours),
      reason: row.reason?.trim() || '',
      statusCode: row.status,
      status: status.tone,
      statusLabel: status.label,
      managerComment: row.managerComment?.trim() || '',
      rhComment: row.rhComment?.trim() || '',
      canDecide,
      submittedAt: row.submittedAt.toISOString(),
      managerDecidedAt: row.managerDecidedAt?.toISOString() ?? null,
      rhDecidedAt: row.rhDecidedAt?.toISOString() ?? null,
      managerName: row.managerValidator
        ? this.fullName(row.managerValidator)
        : null,
      rhName: row.rhValidator ? this.fullName(row.rhValidator) : null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    };
  }

  private toStatus(status: OvertimeStatus) {
    const map: Record<
      OvertimeStatus,
      {
        tone: 'pending' | 'valid' | 'rejected' | 'neutral' | 'review';
        label: string;
      }
    > = {
      [OvertimeStatus.PENDING_MANAGER]: {
        tone: 'pending',
        label: 'En attente N+1',
      },
      [OvertimeStatus.IN_REVIEW_RH]: { tone: 'review', label: 'En attente RH' },
      [OvertimeStatus.APPROVED]: { tone: 'valid', label: 'Approuvée' },
      [OvertimeStatus.REJECTED]: { tone: 'rejected', label: 'Refusée' },
      [OvertimeStatus.CANCELLED]: { tone: 'neutral', label: 'Annulée' },
    };

    return map[status];
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

  private roundHours(value: number) {
    return Math.round(value * 100) / 100;
  }
}
