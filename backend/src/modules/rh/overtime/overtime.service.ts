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
  DecideRhOvertimeDto,
  FindRhOvertimeQueryDto,
  RhOvertimeDecision,
} from './dto/rh-overtime.dto';

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
export class RhOvertimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(query: FindRhOvertimeQueryDto) {
    const year = query.year ?? new Date().getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const departmentCode = query.department?.trim().toUpperCase() || null;

    const where: Prisma.OvertimeRequestWhereInput = {
      workDate: { gte: yearStart, lt: nextYearStart },
      owner: {
        status: { not: UserStatus.INACTIVE },
        ...(departmentCode
          ? { department: { is: { code: departmentCode } } }
          : {}),
      },
    };

    const [rows, departments] = await Promise.all([
      this.prisma.overtimeRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { workDate: 'desc' }],
        select: overtimeSelect,
      }),
      this.prisma.department.findMany({
        orderBy: [{ name: 'asc' }],
        select: { code: true, name: true },
      }),
    ]);

    const responseRows = rows.map((row) => this.toResponse(row));

    const monthlyApproved = new Array<number>(12).fill(0);
    const byDepartmentMap = new Map<
      string,
      {
        departmentCode: string;
        departmentName: string;
        approvedHours: number;
        approvedCount: number;
      }
    >();

    responseRows.forEach((row) => {
      if (row.statusCode !== 'APPROVED') return;
      const month = new Date(`${row.workDate}T00:00:00.000Z`).getUTCMonth();
      monthlyApproved[month] += row.hours;

      const key = row.departmentCode;
      const current = byDepartmentMap.get(key) ?? {
        departmentCode: row.departmentCode,
        departmentName: row.department,
        approvedHours: 0,
        approvedCount: 0,
      };
      current.approvedHours += row.hours;
      current.approvedCount += 1;
      byDepartmentMap.set(key, current);
    });

    return {
      year,
      departments,
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
      monthlyApproved: monthlyApproved.map((value) => this.roundHours(value)),
      byDepartment: Array.from(byDepartmentMap.values())
        .map((item) => ({
          ...item,
          approvedHours: this.roundHours(item.approvedHours),
        }))
        .sort((left, right) =>
          left.departmentName.localeCompare(right.departmentName),
        ),
    };
  }

  async decide(id: string, dto: DecideRhOvertimeDto) {
    const rh = await this.resolveRh(dto.rhId, dto.rhEmail);
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
    if (existing.status !== OvertimeStatus.IN_REVIEW_RH) {
      throw new BadRequestException(
        'La déclaration doit être validée manager avant décision RH',
      );
    }

    const transition = this.transition(dto.decision);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (transaction) => {
      const overtime = await transaction.overtimeRequest.update({
        where: { id },
        data: {
          status: transition.status,
          rhValidatorId: rh.id,
          rhComment: comment || null,
          rhDecidedAt: now,
        },
        select: overtimeSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: rh.id,
          action: transition.auditAction,
          entity: 'OvertimeRequest',
          entityId: overtime.id,
          metadata: {
            source: 'rh',
            decision: dto.decision,
            reference: overtime.reference,
            comment: comment || null,
          },
        },
      });

      const recipients = Array.from(
        new Set(
          [overtime.ownerId, overtime.managerValidator?.id].filter(Boolean),
        ),
      ) as string[];

      if (recipients.length > 0) {
        await transaction.notification.createMany({
          data: recipients.map((userId) => ({
            userId,
            type:
              transition.status === OvertimeStatus.APPROVED
                ? NotificationType.REQUEST_APPROVED
                : NotificationType.REQUEST_REJECTED,
            title:
              transition.status === OvertimeStatus.APPROVED
                ? 'Heure supplémentaire approuvée RH'
                : 'Heure supplémentaire rejetée RH',
            description: `${overtime.reference} — ${this.fullName(overtime.owner)}`,
            link:
              userId === overtime.ownerId
                ? '/heures-supp'
                : '/manager/heures-supp',
          })),
        });
      }

      return overtime;
    });

    // Email employee
    const employeeUser = await this.prisma.user.findUnique({
      where: { id: updated.ownerId },
      select: { email: true },
    });
    if (employeeUser?.email) {
      const approved = updated.status === OvertimeStatus.APPROVED;
      await this.emailService.send({
        to: employeeUser.email,
        link: '/heures-supp',
        actionLabel: 'Consulter ma declaration',
        subject: approved
          ? `Heure supplémentaire approuvée — ${updated.reference}`
          : `Heure supplémentaire rejetée — ${updated.reference}`,
        text: approved
          ? `Votre déclaration d'heure supplémentaire ${updated.reference} (${this.roundHours(updated.hours)} h) a été approuvée par la RH. Elle est désormais comptabilisée.`
          : `Votre déclaration ${updated.reference} a été rejetée par la RH.${updated.rhComment ? ` Motif : ${updated.rhComment}` : ''}`,
      });
    }

    // Email manager validator if present
    if (updated.managerValidator) {
      const managerUser = await this.prisma.user.findUnique({
        where: { id: updated.managerValidator.id },
        select: { email: true },
      });
      if (managerUser?.email) {
        const approved = updated.status === OvertimeStatus.APPROVED;
        await this.emailService.send({
          to: managerUser.email,
          link: '/manager/heures-supp',
          actionLabel: 'Voir la declaration',
          subject: approved
            ? `HS approuvée RH — ${updated.reference}`
            : `HS rejetée RH — ${updated.reference}`,
          text: approved
            ? `La déclaration ${updated.reference} de ${this.fullName(updated.owner)} a été approuvée par la RH.`
            : `La déclaration ${updated.reference} de ${this.fullName(updated.owner)} a été rejetée par la RH.`,
        });
      }
    }

    return this.toResponse(updated);
  }

  private transition(decision: RhOvertimeDecision) {
    if (decision === 'approve') {
      return {
        status: OvertimeStatus.APPROVED,
        auditAction: AuditAction.APPROVE,
      };
    }

    return {
      status: OvertimeStatus.REJECTED,
      auditAction: AuditAction.REJECT,
    };
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

    if (!rh.roles.some((role) => role.role === RoleType.RH)) {
      throw new ForbiddenException(
        'Seul un utilisateur RH peut traiter cette déclaration',
      );
    }

    return rh;
  }

  private toResponse(row: OvertimeRow) {
    const status = this.toStatus(row.status);

    return {
      id: row.id,
      reference: row.reference,
      employeeId: row.owner.id,
      employeeName: this.fullName(row.owner),
      matricule: row.owner.matricule,
      departmentCode: row.owner.department?.code ?? 'NA',
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
