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
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EmailService } from '../../shared/notifications/email.service';
import {
  CancelEmployeeOvertimeDto,
  CreateEmployeeOvertimeDto,
  FindEmployeeOvertimeQueryDto,
  UpdateEmployeeOvertimeDto,
} from './dto/employee-overtime.dto';

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
  createdAt: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      n1Id: true,
      department: {
        select: {
          id: true,
          code: true,
          name: true,
          managerId: true,
        },
      },
    },
  },
  managerValidator: { select: { id: true, nom: true, prenom: true } },
  rhValidator: { select: { id: true, nom: true, prenom: true } },
} satisfies Prisma.OvertimeRequestSelect;

type OvertimeRow = Prisma.OvertimeRequestGetPayload<{
  select: typeof overtimeSelect;
}>;

@Injectable()
export class EmployeeOvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(query: FindEmployeeOvertimeQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const year = query.year ?? new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

    const rows = await this.prisma.overtimeRequest.findMany({
      where: {
        ownerId: user.id,
        workDate: { gte: yearStart, lt: nextYearStart },
      },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
      select: overtimeSelect,
    });

    const responseRows = rows.map((row) => this.toResponse(row));

    return {
      year,
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

  async create(dto: CreateEmployeeOvertimeDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const workDate = this.parseDate(dto.workDate);
    const hours = this.roundHours(dto.hours);

    if (hours <= 0)
      throw new BadRequestException('Le volume horaire est invalide');

    const created = await this.prisma.$transaction(async (transaction) => {
      const overtime = await transaction.overtimeRequest.create({
        data: {
          reference: await this.generateReference(transaction, workDate),
          ownerId: user.id,
          workDate,
          hours,
          reason: dto.reason?.trim() || null,
          status: OvertimeStatus.PENDING_MANAGER,
          submittedAt: new Date(),
        },
        select: overtimeSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.CREATE,
          entity: 'OvertimeRequest',
          entityId: overtime.id,
          metadata: {
            source: 'employee',
            reference: overtime.reference,
            workDate: this.toInputDate(workDate),
            hours,
          },
        },
      });

      const managerTargets = Array.from(
        new Set(
          [overtime.owner.n1Id, overtime.owner.department?.managerId].filter(
            Boolean,
          ),
        ),
      ) as string[];

      if (managerTargets.length > 0) {
        await transaction.notification.createMany({
          data: managerTargets.map((managerId) => ({
            userId: managerId,
            type: NotificationType.REQUEST_SUBMITTED,
            title: 'Nouvelle déclaration heure supplémentaire',
            description: `${overtime.reference} — ${this.fullName(overtime.owner)}`,
            link: '/manager/heures-supp',
          })),
        });
      }

      return overtime;
    });

    // Notify manager(s) by email
    const managerTargetIds = Array.from(
      new Set(
        [created.owner.n1Id, created.owner.department?.managerId].filter(
          Boolean,
        ),
      ),
    ) as string[];

    if (managerTargetIds.length > 0) {
      const managerUsers = await this.prisma.user.findMany({
        where: {
          id: { in: managerTargetIds },
          status: { not: UserStatus.INACTIVE },
        },
        select: { email: true },
      });
      const emails = managerUsers
        .map((u) => u.email?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e));
      if (emails.length > 0) {
        await this.emailService.sendMany(
          emails.map((to) => ({
            to,
            subject: `Nouvelle déclaration HS — ${created.reference}`,
            text: `${this.fullName(created.owner)} a soumis une déclaration d'heure supplémentaire (${this.roundHours(created.hours)} h le ${this.toInputDate(created.workDate)}). Référence : ${created.reference}.`,
            link: '/manager/heures-supp',
            actionLabel: 'Voir les heures supplémentaires',
          })),
        );
      }
    }

    return this.toResponse(created);
  }

  async update(id: string, dto: UpdateEmployeeOvertimeDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.prisma.overtimeRequest.findUnique({
      where: { id },
      select: overtimeSelect,
    });

    if (!existing || existing.ownerId !== user.id) {
      throw new NotFoundException('Déclaration introuvable');
    }

    if (
      existing.status !== OvertimeStatus.PENDING_MANAGER &&
      existing.status !== OvertimeStatus.REJECTED
    ) {
      throw new ForbiddenException(
        'Cette déclaration ne peut plus être modifiée',
      );
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const overtime = await transaction.overtimeRequest.update({
        where: { id },
        data: {
          ...(dto.workDate ? { workDate: this.parseDate(dto.workDate) } : {}),
          ...(dto.hours !== undefined
            ? { hours: this.roundHours(dto.hours) }
            : {}),
          ...(dto.reason !== undefined
            ? { reason: dto.reason.trim() || null }
            : {}),
          status: OvertimeStatus.PENDING_MANAGER,
          submittedAt: new Date(),
          managerComment: null,
          managerDecidedAt: null,
          rhComment: null,
          rhDecidedAt: null,
          managerValidatorId: null,
          rhValidatorId: null,
          cancelledAt: null,
        },
        select: overtimeSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.UPDATE,
          entity: 'OvertimeRequest',
          entityId: overtime.id,
          metadata: {
            source: 'employee',
            reference: overtime.reference,
            action: 'resubmit',
          },
        },
      });

      return overtime;
    });

    return this.toResponse(updated);
  }

  async cancel(id: string, dto: CancelEmployeeOvertimeDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.prisma.overtimeRequest.findUnique({
      where: { id },
      select: overtimeSelect,
    });

    if (!existing || existing.ownerId !== user.id) {
      throw new NotFoundException('Déclaration introuvable');
    }

    if (existing.status === OvertimeStatus.APPROVED) {
      throw new ForbiddenException(
        'Une déclaration approuvée ne peut pas être annulée',
      );
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const overtime = await transaction.overtimeRequest.update({
        where: { id },
        data: {
          status: OvertimeStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        select: overtimeSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.UPDATE,
          entity: 'OvertimeRequest',
          entityId: overtime.id,
          metadata: {
            source: 'employee',
            reference: overtime.reference,
            action: 'cancel',
          },
        },
      });

      return overtime;
    });

    return this.toResponse(updated);
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

  private async generateReference(
    client: Prisma.TransactionClient,
    workDate: Date,
  ) {
    const year = workDate.getUTCFullYear();
    const count = await client.overtimeRequest.count({
      where: { reference: { startsWith: `HS-${year}-` } },
    });

    return `HS-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private toResponse(row: OvertimeRow) {
    const status = this.toStatus(row.status);

    return {
      id: row.id,
      reference: row.reference,
      workDate: this.toInputDate(row.workDate),
      workDateLabel: this.formatDate(row.workDate),
      hours: this.roundHours(row.hours),
      reason: row.reason?.trim() || '',
      statusCode: row.status,
      status: status.tone,
      statusLabel: status.label,
      managerComment: row.managerComment?.trim() || '',
      rhComment: row.rhComment?.trim() || '',
      managerName: row.managerValidator
        ? this.fullName(row.managerValidator)
        : null,
      rhName: row.rhValidator ? this.fullName(row.rhValidator) : null,
      submittedAt: row.submittedAt.toISOString(),
      managerDecidedAt: row.managerDecidedAt?.toISOString() ?? null,
      rhDecidedAt: row.rhDecidedAt?.toISOString() ?? null,
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

  private roundHours(value: number) {
    return Math.round(value * 100) / 100;
  }
}
