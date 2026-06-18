import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditAction,
  LeaveRequestStatus,
  NotificationType,
  Prisma,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DecideRhRequestDto,
  RhRequestDecision,
} from './dto/rh-request-decision.dto';
import { RemarkRhRequestDto } from './dto/rh-request-remark.dto';
import { ImportRhLeaveHistoryDto } from './dto/rh-leave-history-import.dto';
import { EmailService } from '../../shared/notifications/email.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { LeaveBalanceInitializerService } from '../../shared/leave-balances/leave-balance-initializer.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

type BadgeTone =
  | 'valid'
  | 'pending'
  | 'rejected'
  | 'draft'
  | 'review'
  | 'planned';

const TRACKED_REQUEST_STATUSES = [
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.REJECTED,
  LeaveRequestStatus.CANCELLED,
];

type NormalizedHistoryImportRow = {
  reference: string;
  matricule: string;
  type: string;
  startDate: Date;
  endDate: Date;
  days: number;
  rowNumber: number;
};

@Injectable()
export class RhGlobalViewService {
  private readonly logger = new Logger(RhGlobalViewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
  ) {}

  async decideRequest(id: string, dto: DecideRhRequestDto) {
    await this.autoRejectOverdueRequests();

    const rhUser = await this.resolveRh(dto.rhId, dto.rhEmail);
    const comment = dto.comment?.trim();
    const existing = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        ownerId: true,
        startDate: true,
        leaveTypeId: true,
        owner: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            n1Id: true,
          },
        },
      },
    });

    if (!existing) throw new NotFoundException('Demande introuvable');
    if (existing.status !== LeaveRequestStatus.IN_REVIEW) {
      throw new BadRequestException(
        'La demande doit etre validee par le N+1 avant decision RH.',
      );
    }

    const transition = this.getRhTransition(dto.decision);
    const now = new Date();

    const emails = await this.prisma.$transaction(async (transaction) => {
      await transaction.validation.create({
        data: {
          requestId: existing.id,
          validatorId: rhUser.id,
          level: 3,
          decision: transition.validationDecision,
          comment: comment || null,
          decidedAt: now,
        },
      });

      await transaction.leaveRequest.update({
        where: { id: existing.id },
        data: {
          status: transition.status,
          decidedAt: now,
          cancelledAt: null,
        },
      });

      await this.leaveBalanceSync.syncForRequest(existing.id, transaction);

      const recipients = Array.from(
        new Set([existing.ownerId, existing.owner.n1Id].filter(Boolean)),
      ) as string[];

      if (recipients.length > 0) {
        await transaction.notification.createMany({
          data: recipients.map((recipientId) => ({
            userId: recipientId,
            type: transition.notificationType,
            title: transition.notificationTitle,
            description: `${existing.reference} — ${this.fullName(existing.owner)}`,
            link:
              recipientId === existing.ownerId
                ? '/demandes'
                : '/manager/demandes',
          })),
        });
      }

      const recipientUsers =
        recipients.length > 0
          ? await transaction.user.findMany({
              where: {
                id: { in: recipients },
                status: { not: UserStatus.INACTIVE },
              },
              select: { id: true, email: true },
            })
          : [];

      const emails = recipientUsers
        .filter((recipient) => Boolean(recipient.email))
        .map((recipient) => ({
          to: recipient.email,
          subject: transition.notificationTitle,
          text: `Demande ${existing.reference} pour ${this.fullName(existing.owner)}. Decision RH: ${transition.status}.${comment ? ` Motif: ${comment}.` : ''}`,
          link:
            recipient.id === existing.ownerId
              ? '/demandes'
              : '/manager/demandes',
          actionLabel:
            recipient.id === existing.ownerId
              ? 'Consulter ma demande'
              : 'Voir la demande',
        }));

      await transaction.auditLog.create({
        data: {
          userId: rhUser.id,
          action: transition.auditAction,
          entity: 'LeaveRequest',
          entityId: existing.id,
          metadata: {
            source: 'rh',
            decision: dto.decision,
            reference: existing.reference,
            rhName: this.fullName(rhUser),
            rhEmail: rhUser.email,
            comment: comment || null,
          },
        },
      });

      return emails;
    });

    await this.emailService.sendMany(emails);

    return {
      id: existing.id,
      reference: existing.reference,
      status: transition.status,
    };
  }

  async addRemark(id: string, dto: RemarkRhRequestDto) {
    await this.autoRejectOverdueRequests();

    const rhUser = await this.resolveRh(dto.rhId, dto.rhEmail);
    const comment = dto.comment?.trim();
    if (!comment) {
      throw new BadRequestException('La remarque RH est obligatoire.');
    }

    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        reference: true,
        status: true,
        ownerId: true,
        owner: {
          select: {
            nom: true,
            prenom: true,
            n1Id: true,
          },
        },
      },
    });

    if (!request) throw new NotFoundException('Demande introuvable');
    if (request.status !== LeaveRequestStatus.PENDING) {
      throw new BadRequestException(
        "La remarque RH n'est autorisée que pour les demandes en attente N+1.",
      );
    }

    const recipients = Array.from(
      new Set([request.ownerId, request.owner.n1Id].filter(Boolean)),
    ) as string[];

    const emails = await this.prisma.$transaction(async (transaction) => {
      await transaction.validation.create({
        data: {
          requestId: request.id,
          validatorId: rhUser.id,
          level: 3,
          decision: ValidationDecision.REVIEW_REQUESTED,
          comment,
          decidedAt: new Date(),
        },
      });

      if (recipients.length > 0) {
        await transaction.notification.createMany({
          data: recipients.map((recipientId) => ({
            userId: recipientId,
            type: NotificationType.REQUEST_REVIEW,
            title: 'Remarque RH sur la demande de congé',
            description: `${request.reference} — ${comment}`,
            link:
              recipientId === request.ownerId
                ? '/demandes'
                : '/manager/demandes',
          })),
        });
      }

      const users =
        recipients.length > 0
          ? await transaction.user.findMany({
              where: {
                id: { in: recipients },
                status: { not: UserStatus.INACTIVE },
              },
              select: { id: true, email: true },
            })
          : [];

      await transaction.auditLog.create({
        data: {
          userId: rhUser.id,
          action: AuditAction.UPDATE,
          entity: 'LeaveRequest',
          entityId: request.id,
          metadata: {
            source: 'rh',
            action: 'remark_pending_request',
            reference: request.reference,
            comment,
            rhName: this.fullName(rhUser),
            rhEmail: rhUser.email,
          },
        },
      });

      return users
        .map((user) => ({
          id: user.id,
          email: user.email?.trim().toLowerCase(),
        }))
        .filter((user): user is { id: string; email: string } =>
          Boolean(user.email),
        );
    });

    if (emails.length > 0) {
      await this.emailService.sendMany(
        emails.map((recipient) => ({
          to: recipient.email,
          link:
            recipient.id === request.ownerId
              ? '/demandes'
              : '/manager/demandes',
          actionLabel:
            recipient.id === request.ownerId
              ? 'Consulter ma demande'
              : 'Voir la demande',
          subject: 'Remarque RH sur une demande de congé',
          text: `Demande ${request.reference} pour ${this.fullName(request.owner)}. Remarque RH: ${comment}`,
        })),
      );
    }

    return {
      id: request.id,
      reference: request.reference,
      status: request.status,
      noted: true,
    };
  }

  async importHistory(dto: ImportRhLeaveHistoryDto) {
    await this.autoRejectOverdueRequests();

    const rhUser = await this.resolveRh(dto.rhId, dto.rhEmail);
    const rows = this.normalizeHistoryImportRows(dto);

    const result = await this.prisma.$transaction(async (transaction) => {
      const references = rows.map((row) => row.reference);
      const matricules = Array.from(new Set(rows.map((row) => row.matricule)));
      const [existingRequests, employees, leaveTypes] = await Promise.all([
        transaction.leaveRequest.findMany({
          where: { reference: { in: references } },
          select: { reference: true },
        }),
        transaction.user.findMany({
          where: {
            matricule: { in: matricules },
            status: { not: UserStatus.INACTIVE },
          },
          select: {
            id: true,
            matricule: true,
            nom: true,
            prenom: true,
          },
        }),
        transaction.leaveType.findMany({
          where: { active: true },
          select: { id: true, code: true, name: true, category: true },
        }),
      ]);
      const existingReferences = new Set(
        existingRequests.map((request) => request.reference),
      );
      const employeeByMatricule = new Map(
        employees.map((employee) => [employee.matricule, employee]),
      );
      const leaveTypeByCode = new Map(
        leaveTypes.map((leaveType) => [
          this.normalizeImportToken(leaveType.code),
          leaveType,
        ]),
      );
      const importedRows: Array<{
        id: string;
        reference: string;
        matricule: string;
        employeeName: string;
        leaveType: string;
        startDate: string;
        endDate: string;
        days: number;
      }> = [];
      const skippedRows: Array<{
        reference: string;
        matricule: string;
        reason: string;
      }> = [];
      const balanceKeys: Array<{
        userId: string;
        leaveTypeId: string;
        year: number;
      }> = [];

      for (const row of rows) {
        if (existingReferences.has(row.reference)) {
          skippedRows.push({
            reference: row.reference,
            matricule: row.matricule,
            reason: 'Reference deja existante',
          });
          continue;
        }

        const employee = employeeByMatricule.get(row.matricule);
        if (!employee) {
          throw new NotFoundException(
            `Employe actif introuvable pour le matricule ${row.matricule} (ligne ${row.rowNumber})`,
          );
        }

        const leaveTypeCode = this.resolveImportedLeaveTypeCode(row.type);
        const leaveType = leaveTypeByCode.get(leaveTypeCode);
        if (!leaveType) {
          throw new NotFoundException(
            `Type de conge introuvable pour "${row.type}" (ligne ${row.rowNumber})`,
          );
        }

        await this.leaveBalanceInitializer.initializeUserYear(
          employee.id,
          row.startDate.getUTCFullYear(),
          transaction,
        );

        const imported = await transaction.leaveRequest.create({
          data: {
            reference: row.reference,
            ownerId: employee.id,
            leaveTypeId: leaveType.id,
            startDate: row.startDate,
            endDate: row.endDate,
            days: row.days,
            reason: 'Historique importe par RH',
            status: LeaveRequestStatus.APPROVED,
            submittedAt: row.startDate,
            decidedAt: new Date(),
            validations: {
              create: {
                validatorId: rhUser.id,
                level: 3,
                decision: ValidationDecision.APPROVED,
                comment: 'Import historique RH',
                decidedAt: new Date(),
              },
            },
          },
          select: {
            id: true,
            reference: true,
            startDate: true,
            endDate: true,
            days: true,
            ownerId: true,
            leaveTypeId: true,
            owner: { select: { matricule: true, nom: true, prenom: true } },
            leaveType: { select: { name: true, code: true } },
          },
        });

        await transaction.auditLog.create({
          data: {
            userId: rhUser.id,
            action: AuditAction.CREATE,
            entity: 'LeaveRequest',
            entityId: imported.id,
            metadata: {
              source: 'rh_leave_history_import',
              reference: imported.reference,
              matricule: imported.owner.matricule,
              leaveType: imported.leaveType.code,
              days: imported.days,
            },
          },
        });

        balanceKeys.push({
          userId: imported.ownerId,
          leaveTypeId: imported.leaveTypeId,
          year: imported.startDate.getUTCFullYear(),
        });
        importedRows.push({
          id: imported.id,
          reference: imported.reference,
          matricule: imported.owner.matricule,
          employeeName: this.fullName(imported.owner),
          leaveType: imported.leaveType.name,
          startDate: this.toInputDate(imported.startDate),
          endDate: this.toInputDate(imported.endDate),
          days: this.roundDays(imported.days),
        });
        existingReferences.add(row.reference);
      }

      await this.leaveBalanceSync.syncForKeys(balanceKeys, transaction);

      return { importedRows, skippedRows };
    });

    return {
      imported: result.importedRows.length,
      skipped: result.skippedRows.length,
      rows: result.importedRows,
      skippedRows: result.skippedRows,
      totals: {
        days: this.roundDays(
          result.importedRows.reduce((sum, row) => sum + row.days, 0),
        ),
      },
    };
  }

  async findSummary(filters: {
    year?: string;
    department?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    await this.autoRejectOverdueRequests();

    const range = resolveDateRange(filters, { defaultMode: 'year' });
    const year = range.year;
    const department = this.normalizeDepartment(filters.department);

    await this.leaveBalanceSync.syncYear(year);

    const userWhere: Prisma.UserWhereInput = {
      status: { not: UserStatus.INACTIVE },
    };
    const requestWhere: Prisma.LeaveRequestWhereInput = {
      ...overlapDateWhere(range),
      status: { in: TRACKED_REQUEST_STATUSES },
    };

    if (department) {
      userWhere.department = { is: { code: department } };
      requestWhere.owner = { department: { is: { code: department } } };
    }

    const [departments, users, requests] = await Promise.all([
      this.prisma.department.findMany({
        orderBy: { name: 'asc' },
        select: { code: true, name: true },
      }),
      this.prisma.user.findMany({
        where: userWhere,
        orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
        select: {
          id: true,
          nom: true,
          prenom: true,
          department: {
            select: {
              code: true,
              name: true,
              manager: { select: { nom: true, prenom: true } },
            },
          },
          n1: { select: { nom: true, prenom: true } },
          balances: {
            where: { year },
            select: {
              acquired: true,
              carryover: true,
              taken: true,
              scheduled: true,
            },
          },
        },
      }),
      this.prisma.leaveRequest.findMany({
        where: requestWhere,
        orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
        select: {
          id: true,
          reference: true,
          startDate: true,
          endDate: true,
          days: true,
          status: true,
          leaveType: { select: { code: true, name: true } },
          owner: {
            select: {
              nom: true,
              prenom: true,
              department: { select: { code: true, name: true } },
              n1: { select: { nom: true, prenom: true } },
            },
          },
        },
      }),
    ]);

    const rows = users.map((user) => this.toBalanceRow(user));
    const planifications = requests.map((request) =>
      this.toPlanificationRow(request),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      departments,
      rows,
      planifications,
      monthlyLoad: this.buildMonthlyLoad(departments, planifications),
      totals: {
        employees: rows.length,
        plannedDays: this.roundDays(
          rows.reduce((sum, row) => sum + row.planned, 0),
        ),
        liabilityDays: this.roundDays(
          rows.reduce((sum, row) => sum + row.passif, 0),
        ),
        alerts: rows.filter((row) => row.alert.tone !== 'valid').length,
      },
    };
  }

  private toBalanceRow(
    user: Prisma.UserGetPayload<{
      select: {
        id: true;
        nom: true;
        prenom: true;
        department: {
          select: {
            code: true;
            name: true;
            manager: { select: { nom: true; prenom: true } };
          };
        };
        n1: { select: { nom: true; prenom: true } };
        balances: {
          select: {
            acquired: true;
            carryover: true;
            taken: true;
            scheduled: true;
          };
        };
      };
    }>,
  ) {
    const total = this.roundDays(
      user.balances.reduce(
        (sum, balance) => sum + balance.acquired + balance.carryover,
        0,
      ),
    );
    const taken = this.roundDays(
      user.balances.reduce((sum, balance) => sum + balance.taken, 0),
    );
    const planned = this.roundDays(
      user.balances.reduce((sum, balance) => sum + balance.scheduled, 0),
    );
    const remaining = this.roundDays(total - taken - planned);
    const liability = Math.max(remaining, 0);

    return {
      id: user.id,
      employee: this.fullName(user),
      departmentCode: user.department?.code ?? 'NONE',
      departmentName: user.department?.name ?? 'Sans département',
      manager:
        this.fullName(user.n1) ||
        this.fullName(user.department?.manager) ||
        'Non renseigné',
      total,
      taken,
      planned,
      remaining,
      passif: this.roundDays(liability),
      alert: this.buildBalanceAlert(total, planned, remaining),
    };
  }

  private toPlanificationRow(
    request: Prisma.LeaveRequestGetPayload<{
      select: {
        id: true;
        reference: true;
        startDate: true;
        endDate: true;
        days: true;
        status: true;
        leaveType: { select: { code: true; name: true } };
        owner: {
          select: {
            nom: true;
            prenom: true;
            department: { select: { code: true; name: true } };
            n1: { select: { nom: true; prenom: true } };
          };
        };
      };
    }>,
  ) {
    const status = this.toBadgeStatus(request.status);

    return {
      id: request.id,
      reference: request.reference,
      employee: this.fullName(request.owner),
      manager: this.fullName(request.owner.n1) || 'Non renseigné',
      departmentCode: request.owner.department?.code ?? 'NONE',
      departmentName: request.owner.department?.name ?? 'Sans département',
      startDate: this.formatDate(request.startDate),
      endDate: this.formatDate(request.endDate),
      startDateIso: request.startDate.toISOString().slice(0, 10),
      endDateIso: request.endDate.toISOString().slice(0, 10),
      days: this.roundDays(request.days),
      type: request.leaveType.name,
      statusCode: request.status,
      status: status.tone,
      label: status.label,
      month: request.startDate.getUTCMonth(),
    };
  }

  private buildMonthlyLoad(
    departments: { code: string; name: string }[],
    planifications: { departmentCode: string; days: number; month: number }[],
  ) {
    const rows = departments.map((department) => ({
      departmentCode: department.code,
      departmentName: department.name,
      months: Array.from({ length: 12 }, () => 0),
    }));
    const rowByDepartment = new Map(
      rows.map((row) => [row.departmentCode, row]),
    );

    for (const planification of planifications) {
      const row = rowByDepartment.get(planification.departmentCode);
      if (row) row.months[planification.month] += planification.days;
    }

    return rows.map((row) => ({
      ...row,
      months: row.months.map((value) => this.roundDays(value)),
    }));
  }

  private buildBalanceAlert(total: number, planned: number, remaining: number) {
    if (remaining < 0) {
      return { tone: 'rejected' as const, label: 'Solde dépassé' };
    }
    if (total > 0 && planned === 0) {
      return { tone: 'pending' as const, label: 'Planning incomplet' };
    }
    if (total === 0) {
      return { tone: 'neutral' as const, label: 'Solde non initialisé' };
    }

    return { tone: 'valid' as const, label: 'Conforme' };
  }

  private toBadgeStatus(status: LeaveRequestStatus): {
    tone: BadgeTone;
    label: string;
  } {
    const statusMap: Record<
      LeaveRequestStatus,
      { tone: BadgeTone; label: string }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'planned', label: 'Planifié' },
      [LeaveRequestStatus.PENDING]: { tone: 'pending', label: 'À confirmer' },
      [LeaveRequestStatus.IN_REVIEW]: { tone: 'review', label: 'En revue' },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Confirmé RH' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Rejeté' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'rejected', label: 'Annulé' },
    };

    return statusMap[status];
  }

  private normalizeHistoryImportRows(dto: ImportRhLeaveHistoryDto) {
    if (!dto.rows?.length) {
      throw new BadRequestException('Aucune ligne d historique a importer');
    }

    const rows = dto.rows.map((row, index) => {
      const rowNumber = index + 1;
      const reference = row.reference.trim();
      const matricule = row.matricule.trim();
      const type = row.type.trim();
      const startDate = this.parseImportDate(row.startDate, 'date debut', rowNumber);
      const endDate = this.parseImportDate(row.endDate, 'date fin', rowNumber);
      const days = this.roundDays(Number(row.days));

      if (!reference) {
        throw new BadRequestException(`Reference manquante a la ligne ${rowNumber}`);
      }
      if (!matricule) {
        throw new BadRequestException(`Matricule manquant a la ligne ${rowNumber}`);
      }
      if (!type) {
        throw new BadRequestException(`Type de conge manquant a la ligne ${rowNumber}`);
      }
      if (!Number.isFinite(days) || days <= 0) {
        throw new BadRequestException(`Nombre de jours invalide a la ligne ${rowNumber}`);
      }
      if (endDate < startDate) {
        throw new BadRequestException(
          `Date de fin avant date de debut a la ligne ${rowNumber}`,
        );
      }

      return {
        reference,
        matricule,
        type,
        startDate,
        endDate,
        days,
        rowNumber,
      } satisfies NormalizedHistoryImportRow;
    });

    const seenReferences = new Set<string>();
    const duplicate = rows.find((row) => {
      const key = row.reference.toUpperCase();
      if (seenReferences.has(key)) return true;
      seenReferences.add(key);
      return false;
    });
    if (duplicate) {
      throw new BadRequestException(
        `Reference en double dans le fichier: ${duplicate.reference}`,
      );
    }

    return rows;
  }

  private parseImportDate(value: string, field: string, rowNumber: number) {
    const raw = value.trim();
    const frenchDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const parts = frenchDate
      ? {
          year: Number(frenchDate[3]),
          month: Number(frenchDate[2]),
          day: Number(frenchDate[1]),
        }
      : isoDate
        ? {
            year: Number(isoDate[1]),
            month: Number(isoDate[2]),
            day: Number(isoDate[3]),
          }
        : null;

    if (!parts) {
      throw new BadRequestException(`${field} invalide a la ligne ${rowNumber}`);
    }

    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const valid =
      date.getUTCFullYear() === parts.year &&
      date.getUTCMonth() === parts.month - 1 &&
      date.getUTCDate() === parts.day;

    if (Number.isNaN(date.getTime()) || !valid) {
      throw new BadRequestException(`${field} invalide a la ligne ${rowNumber}`);
    }

    return date;
  }

  private resolveImportedLeaveTypeCode(value: string) {
    const token = this.normalizeImportToken(value);

    if (
      ['CP', 'PAYE', 'PAYER', 'CONGEPAYE', 'CONGESPAYES', 'PAID'].includes(
        token,
      )
    ) {
      return 'CP';
    }
    if (
      ['SPE', 'SPECIAL', 'SPECIAUX', 'CONGESPECIAL', 'CONGESSPECIAUX'].includes(
        token,
      )
    ) {
      return 'SPE';
    }

    return token;
  }

  private normalizeImportToken(value: string) {
    return value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  private parseYear(value: string | undefined) {
    if (!value) return new Date().getUTCFullYear();

    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private normalizeDepartment(value: string | undefined) {
    if (!value || value === 'ALL') return undefined;
    return value.trim();
  }

  private fullName(user?: { nom: string; prenom: string } | null) {
    if (!user) return '';
    return `${user.prenom} ${user.nom}`.trim();
  }

  private async resolveRh(rhId?: string, rhEmail?: string) {
    const where = rhId?.trim()
      ? { id: rhId.trim() }
      : rhEmail?.trim()
        ? { email: rhEmail.trim().toLowerCase() }
        : null;

    if (!where) throw new BadRequestException('Utilisateur RH requis');

    const user = await this.prisma.user.findUnique({
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

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur RH introuvable');
    }
    if (
      !user.roles.some(
        (role) => role.role === RoleType.RH || role.role === RoleType.ADMIN,
      )
    ) {
      throw new ForbiddenException(
        'Utilisateur non autorise a confirmer les demandes',
      );
    }

    return user;
  }

  private getRhTransition(decision: RhRequestDecision) {
    const transitions: Record<
      RhRequestDecision,
      {
        status: LeaveRequestStatus;
        validationDecision: ValidationDecision;
        auditAction: AuditAction;
        notificationType: NotificationType;
        notificationTitle: string;
      }
    > = {
      approve: {
        status: LeaveRequestStatus.APPROVED,
        validationDecision: ValidationDecision.APPROVED,
        auditAction: AuditAction.APPROVE,
        notificationType: NotificationType.REQUEST_APPROVED,
        notificationTitle: 'Demande confirmee par RH',
      },
      reject: {
        status: LeaveRequestStatus.REJECTED,
        validationDecision: ValidationDecision.REJECTED,
        auditAction: AuditAction.REJECT,
        notificationType: NotificationType.REQUEST_REJECTED,
        notificationTitle: 'Demande refusee par RH',
      },
    };

    return transitions[decision];
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('fr-FR').format(date);
  }

  private toInputDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private async autoRejectOverdueRequests() {
    const delayDays = this.getAutoRejectDelayDays();
    if (delayDays <= 0) return;

    const cutoffDate = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000);
    const autoRhUser = await this.findAutoRhUser();
    if (!autoRhUser) {
      this.logger.warn(
        'Auto-refus RH ignore: aucun utilisateur RH/ADMIN actif disponible.',
      );
      return;
    }

    const overdue = await this.prisma.leaveRequest.findMany({
      where: {
        status: LeaveRequestStatus.IN_REVIEW,
        updatedAt: { lte: cutoffDate },
      },
      select: {
        id: true,
        reference: true,
        ownerId: true,
        startDate: true,
        leaveTypeId: true,
        owner: {
          select: {
            nom: true,
            prenom: true,
            n1Id: true,
          },
        },
      },
    });

    if (overdue.length === 0) return;

    const now = new Date();
    const emailTargets: Array<{ email: string; link: string }> = [];

    await this.prisma.$transaction(async (transaction) => {
      for (const request of overdue) {
        await transaction.validation.create({
          data: {
            requestId: request.id,
            validatorId: autoRhUser.id,
            level: 3,
            decision: ValidationDecision.REJECTED,
            comment: `Refus automatique RH apres ${delayDays} jour(s) sans decision.`,
            decidedAt: now,
          },
        });

        await transaction.leaveRequest.update({
          where: { id: request.id },
          data: {
            status: LeaveRequestStatus.REJECTED,
            decidedAt: now,
            cancelledAt: null,
          },
        });

        await this.leaveBalanceSync.syncForRequest(request.id, transaction);

        const recipients = Array.from(
          new Set([request.ownerId, request.owner.n1Id].filter(Boolean)),
        ) as string[];

        if (recipients.length > 0) {
          await transaction.notification.createMany({
            data: recipients.map((recipientId) => ({
              userId: recipientId,
              type: NotificationType.REQUEST_REJECTED,
              title: 'Demande refusee automatiquement (delai RH depasse)',
              description: `${request.reference} — ${this.fullName(request.owner)}`,
              link:
                recipientId === request.ownerId
                  ? '/demandes'
                  : '/manager/demandes',
            })),
          });

          const recipientUsers = await transaction.user.findMany({
            where: {
              id: { in: recipients },
              status: { not: UserStatus.INACTIVE },
            },
            select: { id: true, email: true },
          });

          for (const recipient of recipientUsers) {
            const email = recipient.email?.trim().toLowerCase();
            if (email) {
              emailTargets.push({
                email,
                link:
                  recipient.id === request.ownerId
                    ? '/demandes'
                    : '/manager/demandes',
              });
            }
          }
        }

        await transaction.auditLog.create({
          data: {
            userId: autoRhUser.id,
            action: AuditAction.REJECT,
            entity: 'LeaveRequest',
            entityId: request.id,
            metadata: {
              source: 'rh-auto',
              reason: 'timeout',
              delayDays,
              reference: request.reference,
              rhName: this.fullName(autoRhUser),
              rhEmail: autoRhUser.email,
            },
          },
        });
      }
    });

    const uniqueEmails = Array.from(
      new Map(emailTargets.map((target) => [target.email, target])).values(),
    );
    if (uniqueEmails.length > 0) {
      await this.emailService.sendMany(
        uniqueEmails.map((recipient) => ({
          to: recipient.email,
          subject: 'Demande refusee automatiquement (delai RH depasse)',
          text: `Une demande en attente RH a ete refusee automatiquement apres ${delayDays} jour(s) sans decision.`,
          link: recipient.link,
          actionLabel: 'Consulter la demande',
        })),
      );
    }
  }

  private getAutoRejectDelayDays() {
    const raw = this.configService.get<string>('RH_AUTO_REJECT_DAYS') ?? '7';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed);
  }

  private async findAutoRhUser() {
    return this.prisma.user.findFirst({
      where: {
        status: { not: UserStatus.INACTIVE },
        roles: {
          some: {
            role: { in: [RoleType.RH, RoleType.ADMIN] },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
      },
    });
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
