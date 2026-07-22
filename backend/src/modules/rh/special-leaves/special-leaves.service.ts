import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  NotificationType,
  Prisma,
  Sexe,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { EmailService } from '../../shared/notifications/email.service';
import {
  CreateRhSpecialLeaveDto,
  ImportRhSpecialLeavesDto,
  ImportRhSpecialLeaveRowDto,
  UpdateRhSpecialLeaveDto,
} from './dto/rh-special-leave.dto';
import {
  fieldDateWhere,
  overlapDateWhere,
  resolveDateRange,
} from '../../../common/date-range';
import {
  getCurrentLeaveYear,
  getLeaveYear,
  getLeaveYearRange,
  getLeaveYearsForPeriod,
  splitPeriodByLeaveYear,
} from '../../../common/leave-year';
import {
  countWorkingDays,
  endDateForWorkingDays,
} from '../../../common/working-days';

type BadgeTone = 'valid' | 'pending' | 'rejected' | 'draft' | 'neutral';
type PrismaClientLike = PrismaService | Prisma.TransactionClient;
type SpecialLeaveEventKind =
  | 'birth'
  | 'marriage'
  | 'death'
  | 'illness'
  | 'other';
type EventLeaveType = {
  id: string;
  code: string;
  name: string;
  category: LeaveCategory;
  defaultDays: number;
  active?: boolean;
};
type ActiveEmployee = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  sexe: Sexe;
  status: UserStatus;
};
const BIRTH_LEAVE_FALLBACK_DAYS = {
  [Sexe.F]: 90,
  [Sexe.M]: 3,
} as const;
const SPECIAL_EVENT_FALLBACK_DAYS = {
  marriage: 3,
  death: 3,
  illness: 1,
  other: 1,
} as const;
const EVENT_LEAVE_CATEGORIES = [
  LeaveCategory.CONGE_SPECIAL,
  LeaveCategory.CONGE_PATERNITE,
  LeaveCategory.CONGE_MATERNITE,
  LeaveCategory.CONGE_MALADIE,
] as const;

const specialLeaveSelect = {
  id: true,
  reference: true,
  ownerId: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  status: true,
  submittedAt: true,
  decidedAt: true,
  cancelledAt: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      department: { select: { name: true } },
    },
  },
  leaveType: {
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      defaultDays: true,
    },
  },
  attachments: { select: { id: true, filename: true, url: true } },
} satisfies Prisma.LeaveRequestSelect;

type SpecialLeaveRecord = Prisma.LeaveRequestGetPayload<{
  select: typeof specialLeaveSelect;
}>;

const eventRowSelect = {
  id: true,
  type: true,
  eventDate: true,
  description: true,
  processed: true,
  proofUrl: true,
  status: true,
  rhComment: true,
  reviewedAt: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      email: true,
      department: { select: { name: true } },
    },
  },
} satisfies Prisma.EventSelect;

type EventRowRecord = Prisma.EventGetPayload<{ select: typeof eventRowSelect }>;

@Injectable()
export class RhSpecialLeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(
    filters: {
      year?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ) {
    const range = resolveDateRange(filters, { defaultMode: 'year' });
    const year = range.year;
    const eventDate = fieldDateWhere(range);

    const [requests, balances, events] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          ...overlapDateWhere(range),
          reference: { startsWith: 'CS-' },
          leaveType: { category: { in: [...EVENT_LEAVE_CATEGORIES] } },
        },
        orderBy: [{ startDate: 'desc' }, { reference: 'desc' }],
        select: specialLeaveSelect,
      }),
      this.prisma.leaveBalance.findMany({
        where: {
          year,
          leaveType: { category: { in: [...EVENT_LEAVE_CATEGORIES] } },
        },
        select: {
          userId: true,
          leaveTypeId: true,
          acquired: true,
          carryover: true,
          taken: true,
          scheduled: true,
        },
      }),
      this.prisma.event.findMany({
        where: {
          ...(eventDate ? { eventDate } : {}),
          user: { status: { not: UserStatus.INACTIVE } },
          OR: [
            { description: null },
            {
              description: {
                not: { startsWith: 'Enfant RH ' },
              },
            },
          ],
        },
        orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
        select: eventRowSelect,
      }),
    ]);
    const balanceByUser = new Map(
      balances.map((balance) => [
        this.balanceMapKey(balance.userId, balance.leaveTypeId),
        balance,
      ]),
    );

    const requestRows = requests.map((request) =>
      this.toResponse(
        request,
        balanceByUser.get(
          this.balanceMapKey(request.ownerId, request.leaveType.id),
        ),
      ),
    );
    const eventRows = events.map((event) => this.toEventRow(event));
    const rows = [...eventRows, ...requestRows].sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      rows,
      totals: this.buildTotalsFromRows(rows),
    };
  }

  async create(dto: CreateRhSpecialLeaveDto) {
    const created = await this.prisma.$transaction(async (transaction) => {
      const employee = await this.ensureActiveEmployee(
        transaction,
        dto.employeeId,
      );
      return this.createComputedRequest(transaction, dto, employee);
    });

    // Notify employee by email
    const owner = await this.prisma.user.findUnique({
      where: { id: dto.employeeId },
      select: { email: true, nom: true, prenom: true },
    });
    if (owner?.email) {
      await this.emailService.send({
        to: owner.email,
        subject: `Congé spécial enregistré — ${created.reference}`,
        text: `Un congé spécial a été enregistré pour vous par la RH. Référence : ${created.reference}. Événement : ${created.eventLabel}. Période : ${created.startDate} → ${created.endDate} (${created.days} j). Statut : ${created.statusLabel}.`,
        link: '/demandes',
        actionLabel: 'Consulter mes demandes',
      });
    }
    return created;
  }

  async importRows(dto: ImportRhSpecialLeavesDto) {
    if (!dto.rows.length) {
      throw new BadRequestException('Aucune ligne de conge special a importer');
    }

    const normalizedRows = dto.rows.map((row, index) =>
      this.normalizeImportRow(row, index),
    );
    this.ensureUniqueImportRows(normalizedRows);

    return this.prisma.$transaction(async (transaction) => {
      const results: Array<{
        rowNumber: number;
        matricule: string;
        employeeId: string;
        employeeName: string;
        eventLabel: string;
        leaveTypeCode: string;
        eventDate: string | null;
        startDate: string | null;
        endDate: string | null;
        days: number;
        status: LeaveRequestStatus;
        imported: boolean;
        skippedReason?: string;
      }> = [];

      for (const row of normalizedRows) {
        const employee = await transaction.user.findUnique({
          where: { matricule: row.matricule },
          select: {
            id: true,
            matricule: true,
            nom: true,
            prenom: true,
            sexe: true,
            status: true,
          },
        });

        if (!employee || employee.status === UserStatus.INACTIVE) {
          throw new NotFoundException(
            `Employe actif introuvable pour le matricule ${row.matricule}`,
          );
        }

        const leaveType = await this.resolveEventLeaveType(
          transaction,
          undefined,
          row.eventLabel,
          employee.sexe,
        );

        if (!row.startDate || !row.startDateInput) {
          results.push({
            rowNumber: row.rowNumber,
            matricule: employee.matricule,
            employeeId: employee.id,
            employeeName: this.fullName(employee),
            eventLabel: row.eventLabel,
            leaveTypeCode: leaveType.code,
            eventDate: row.eventDate,
            startDate: null,
            endDate: null,
            days: 0,
            status: row.status,
            imported: false,
            skippedReason: 'Date debut absente',
          });
          continue;
        }

        const schedule = await this.computeEventSchedule(transaction, {
          eventLabel: row.eventLabel,
          leaveType,
          sexe: employee.sexe,
          startDate: row.startDate,
        });
        const existing = await this.findExistingImportedRequest(transaction, {
          employeeId: employee.id,
          eventLabel: row.eventLabel,
          startDate: schedule.startDate,
        });

        if (existing) {
          results.push({
            rowNumber: row.rowNumber,
            matricule: employee.matricule,
            employeeId: employee.id,
            employeeName: this.fullName(employee),
            eventLabel: row.eventLabel,
            leaveTypeCode: existing.leaveType.code,
            eventDate: row.eventDate,
            startDate: existing.startDate.toISOString().slice(0, 10),
            endDate: existing.endDate.toISOString().slice(0, 10),
            days: this.roundDays(existing.days),
            status: existing.status,
            imported: false,
            skippedReason: 'Deja importe',
          });
          continue;
        }

        const created = await this.createComputedRequest(
          transaction,
          {
            employeeId: employee.id,
            eventLabel: row.eventLabel,
            startDate: row.startDateInput,
            status: row.status,
            reason: this.buildImportReason(row),
            proofUrl: row.proofUrl,
            proofFilename: row.proofFilename,
          },
          employee,
        );

        results.push({
          rowNumber: row.rowNumber,
          matricule: created.matricule,
          employeeId: created.employeeId,
          employeeName: created.employeeName,
          eventLabel: created.eventLabel,
          leaveTypeCode: created.leaveTypeCode,
          eventDate: row.eventDate,
          startDate: created.startDate,
          endDate: created.endDate,
          days: created.days,
          status: created.statusCode,
          imported: true,
        });
      }

      await transaction.auditLog.create({
        data: {
          userId: dto.importedById?.trim() || null,
          action: AuditAction.CREATE,
          entity: 'LeaveRequest',
          metadata: {
            source: 'rh_special_leaves_import',
            imported: results.filter((row) => row.imported).length,
            skipped: results.filter((row) => !row.imported).length,
            rows: results.map((row) => ({
              rowNumber: row.rowNumber,
              matricule: row.matricule,
              eventLabel: row.eventLabel,
              eventDate: row.eventDate,
              startDate: row.startDate,
              imported: row.imported,
              skippedReason: row.skippedReason ?? null,
            })),
          },
        },
      });

      return {
        imported: results.filter((row) => row.imported).length,
        skipped: results.filter((row) => !row.imported).length,
        rows: results,
      };
    });
  }

  async update(id: string, dto: UpdateRhSpecialLeaveDto) {
    if (this.isEventRowId(id)) {
      return this.reviewEventFromSpecialLeaves(id, dto);
    }

    const existing = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: {
        id: true,
        ownerId: true,
        startDate: true,
        endDate: true,
        leaveTypeId: true,
        reason: true,
        leaveType: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            defaultDays: true,
          },
        },
        owner: {
          select: {
            id: true,
            matricule: true,
            nom: true,
            prenom: true,
            sexe: true,
            status: true,
          },
        },
      },
    });
    if (!existing || !this.isEventLeaveCategory(existing.leaveType.category)) {
      throw new NotFoundException('Congé spécial introuvable');
    }

    const notificationStatus = dto.status;
    const notificationEmployeeId = existing.ownerId;

    const updated = await this.prisma.$transaction(async (transaction) => {
      const data: Prisma.LeaveRequestUpdateInput = {};
      const employee =
        dto.employeeId !== undefined
          ? await this.ensureActiveEmployee(transaction, dto.employeeId)
          : existing.owner;
      const eventLabel =
        dto.eventLabel ?? this.extractEventLabel(existing.reason);
      const startDate =
        dto.startDate ?? existing.startDate.toISOString().slice(0, 10);
      const leaveType = await this.resolveEventLeaveType(
        transaction,
        dto.leaveTypeId ?? existing.leaveTypeId,
        eventLabel,
        employee.sexe,
      );
      const schedule = await this.computeEventSchedule(transaction, {
        eventLabel,
        leaveType,
        sexe: employee.sexe,
        startDate,
      });

      if (dto.employeeId !== undefined) {
        data.owner = { connect: { id: employee.id } };
      }
      data.leaveType = { connect: { id: leaveType.id } };
      data.startDate = schedule.startDate;
      data.endDate = schedule.endDate;
      data.days = schedule.days;
      if (dto.eventLabel !== undefined || dto.reason !== undefined) {
        data.reason = this.buildReason(
          eventLabel || 'Conge special',
          dto.reason,
        );
      }
      if (dto.status !== undefined) {
        data.status = dto.status;
        data.decidedAt = this.isFinalStatus(dto.status) ? new Date() : null;
        data.cancelledAt =
          dto.status === LeaveRequestStatus.CANCELLED ? new Date() : null;
      }
      if (dto.proofUrl !== undefined || dto.proofFilename !== undefined) {
        const attachments = this.toAttachmentCreate(dto);
        data.attachments = {
          deleteMany: {},
          ...(attachments ?? {}),
        };
      }

      const request = await transaction.leaveRequest.update({
        where: { id },
        data,
        select: specialLeaveSelect,
      });
      this.ensureDateRange(request.startDate, request.endDate);

      await Promise.all([
        this.syncBalanceForLeaveTypeForPeriod(
          transaction,
          existing.ownerId,
          existing.startDate,
          existing.endDate,
          existing.leaveType,
        ),
        this.syncBalanceForLeaveTypeForPeriod(
          transaction,
          request.ownerId,
          request.startDate,
          request.endDate,
          request.leaveType,
        ),
      ]);

      await Promise.all([
        this.syncBirthEventDecisionAndBalances(transaction, request),
        existing.id === request.id &&
        (existing.ownerId !== request.ownerId ||
          existing.startDate.getTime() !== request.startDate.getTime() ||
          existing.endDate.getTime() !== request.endDate.getTime())
          ? this.syncBirthLeaveBalancesForPeriod(
              transaction,
              existing.ownerId,
              existing.startDate,
              existing.endDate,
            )
          : Promise.resolve(),
      ]);

      return this.toResponse(request);
    });

    // Notify employee if status was explicitly changed
    if (notificationStatus !== undefined) {
      const owner = await this.prisma.user.findUnique({
        where: { id: notificationEmployeeId },
        select: { email: true },
      });
      if (owner?.email) {
        const statusLabel = this.toBadgeStatus(notificationStatus).label;
        await this.emailService.send({
          to: owner.email,
          subject: `Congé spécial mis à jour`,
          text: `Votre congé spécial a été mis à jour par la RH. Nouveau statut : ${statusLabel}.`,
          link: '/demandes',
          actionLabel: 'Consulter mes demandes',
        });
      }
    }

    return updated;
  }

  async cancel(id: string) {
    if (this.isEventRowId(id)) {
      return this.reviewEventFromSpecialLeaves(id, {
        status: LeaveRequestStatus.CANCELLED,
      });
    }

    return this.update(id, { status: LeaveRequestStatus.CANCELLED });
  }

  private async createComputedRequest(
    transaction: Prisma.TransactionClient,
    dto: Pick<
      CreateRhSpecialLeaveDto,
      | 'employeeId'
      | 'eventLabel'
      | 'startDate'
      | 'status'
      | 'reason'
      | 'proofUrl'
      | 'proofFilename'
      | 'leaveTypeId'
    >,
    employee: ActiveEmployee,
  ) {
    const leaveType = await this.resolveEventLeaveType(
      transaction,
      dto.leaveTypeId,
      dto.eventLabel,
      employee.sexe,
    );
    const schedule = await this.computeEventSchedule(transaction, {
      eventLabel: dto.eventLabel,
      leaveType,
      sexe: employee.sexe,
      startDate: dto.startDate,
    });
    const status = dto.status ?? LeaveRequestStatus.APPROVED;

    const request = await transaction.leaveRequest.create({
      data: {
        reference: await this.generateReference(
          transaction,
          schedule.startDate,
        ),
        ownerId: dto.employeeId,
        leaveTypeId: leaveType.id,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        days: schedule.days,
        reason: this.buildReason(dto.eventLabel, dto.reason),
        status,
        submittedAt: new Date(),
        decidedAt: this.isFinalStatus(status) ? new Date() : null,
        ...this.toAttachmentCreateData(dto),
      },
      select: specialLeaveSelect,
    });

    await this.syncBalanceForLeaveTypeForPeriod(
      transaction,
      request.ownerId,
      request.startDate,
      request.endDate,
      request.leaveType,
    );
    await this.syncBirthEventDecisionAndBalances(transaction, request);

    return this.toResponse(request);
  }

  private normalizeImportRow(row: ImportRhSpecialLeaveRowDto, index: number) {
    const rowNumber = index + 2;
    const matricule = row.matricule.trim();
    const eventLabel = row.eventLabel.trim();
    const eventDate = row.eventDate?.trim() || null;
    if (eventDate) {
      this.parseDate(
        eventDate,
        `Date evenement invalide a la ligne ${rowNumber}`,
      );
    }
    const startDateInput = row.startDate?.trim() || null;
    const startDate = startDateInput
      ? this.parseDate(
          startDateInput,
          `Date de debut invalide a la ligne ${rowNumber}`,
        )
      : null;

    if (!matricule) {
      throw new BadRequestException(
        `Matricule manquant a la ligne ${rowNumber}`,
      );
    }
    if (!eventLabel) {
      throw new BadRequestException(
        `Evenement manquant a la ligne ${rowNumber}`,
      );
    }

    return {
      rowNumber,
      matricule,
      eventLabel,
      eventDate,
      startDate,
      startDateInput,
      status: row.status ?? LeaveRequestStatus.APPROVED,
      reason: row.reason?.trim() || undefined,
      proofUrl: row.proofUrl?.trim() || undefined,
      proofFilename: row.proofFilename?.trim() || undefined,
    };
  }

  private ensureUniqueImportRows(
    rows: ReturnType<RhSpecialLeavesService['normalizeImportRow']>[],
  ) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = [
        row.matricule.toUpperCase(),
        this.normalizeImportToken(row.eventLabel),
        row.eventDate ?? 'NULL_EVENT_DATE',
        row.startDateInput ?? 'NULL_START_DATE',
      ].join(':');
      if (seen.has(key)) {
        throw new BadRequestException(
          `Ligne en double dans le fichier: ${row.matricule} / ${row.eventLabel} / ${row.eventDate ?? 'Date evenement vide'} / ${row.startDateInput ?? 'Date debut vide'}`,
        );
      }
      seen.add(key);
    }
  }

  private buildImportReason(
    row: ReturnType<RhSpecialLeavesService['normalizeImportRow']>,
  ) {
    const parts = [row.reason];
    if (row.eventDate) parts.push(`Date evenement: ${row.eventDate}`);
    return parts.filter(Boolean).join(' | ') || undefined;
  }

  private async reviewEventFromSpecialLeaves(
    rowId: string,
    dto: UpdateRhSpecialLeaveDto,
  ) {
    const eventId = this.parseEventId(rowId);

    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.event.findUnique({
        where: { id: eventId },
        select: {
          ...eventRowSelect,
          userId: true,
          user: {
            select: {
              id: true,
              matricule: true,
              nom: true,
              prenom: true,
              sexe: true,
              dateEmbauche: true,
              passifInitial: true,
              department: { select: { name: true } },
              children: { select: { dateNaissance: true } },
              events: {
                select: { type: true, eventDate: true, processed: true },
              },
              status: true,
            },
          },
        },
      });

      if (!event || event.user.status === UserStatus.INACTIVE) {
        throw new NotFoundException('Événement introuvable');
      }

      const status = dto.status;
      if (
        status !== undefined &&
        status !== LeaveRequestStatus.IN_REVIEW &&
        status !== LeaveRequestStatus.APPROVED &&
        status !== LeaveRequestStatus.REJECTED &&
        status !== LeaveRequestStatus.CANCELLED
      ) {
        throw new BadRequestException(
          'Décision RH invalide pour cet événement',
        );
      }

      if (status === undefined) {
        throw new BadRequestException('Une décision RH est requise');
      }

      const rhComment = dto.rhComment?.trim() || null;
      if (
        (status === LeaveRequestStatus.IN_REVIEW ||
          status === LeaveRequestStatus.REJECTED) &&
        !rhComment
      ) {
        throw new BadRequestException(
          'Un commentaire RH est obligatoire pour cette décision',
        );
      }

      const processed = status === LeaveRequestStatus.APPROVED;

      const updated = await transaction.event.update({
        where: { id: event.id },
        data: {
          processed,
          status,
          rhComment,
          reviewedAt: new Date(),
          description: this.stripLegacyEventStatusMarker(event.description),
        },
        select: eventRowSelect,
      });

      if (updated.type === EventType.BIRTH && processed) {
        await this.ensureChildFromBirthEvent(
          transaction,
          updated.user.id,
          updated.eventDate,
        );
      }

      await this.syncBirthLeaveBalancesForPeriod(
        transaction,
        updated.user.id,
        updated.eventDate,
        updated.eventDate,
      );

      await transaction.auditLog.create({
        data: {
          userId: dto.rhId ?? null,
          action: AuditAction.UPDATE,
          entity: 'Event',
          entityId: updated.id,
          metadata: {
            source: 'rh_special_leaves',
            decision: status,
            comment: rhComment,
            ownerId: updated.user.id,
          },
        },
      });

      await transaction.notification.create({
        data: {
          userId: updated.user.id,
          type: NotificationType.SYSTEM,
          title:
            status === LeaveRequestStatus.APPROVED
              ? 'Événement validé par la RH'
              : status === LeaveRequestStatus.IN_REVIEW
                ? 'Événement mis en revue par la RH'
                : 'Événement refusé par la RH',
          description: rhComment ?? 'Consultez le suivi de votre déclaration.',
          link: '/declarer',
        },
      });

      const eventRow = this.toEventRow(updated);

      // Notify employee by email
      if (updated.user.email) {
        const approved = status === LeaveRequestStatus.APPROVED;
        const inReview = status === LeaveRequestStatus.IN_REVIEW;
        await this.emailService.send({
          to: updated.user.email,
          link: '/declarer',
          actionLabel: 'Voir mes declarations',
          subject: approved
            ? `Événement validé — ${this.eventTypeLabel(updated.type)}`
            : inReview
              ? `Événement en revue — ${this.eventTypeLabel(updated.type)}`
              : `Événement refusé — ${this.eventTypeLabel(updated.type)}`,
          text: approved
            ? `Votre déclaration d'événement (${this.eventTypeLabel(updated.type)} du ${updated.eventDate.toISOString().slice(0, 10)}) a été validée par la RH.`
            : inReview
              ? `Votre déclaration d'événement (${this.eventTypeLabel(updated.type)} du ${updated.eventDate.toISOString().slice(0, 10)}) a été mise en revue par la RH.${rhComment ? ` Commentaire : ${rhComment}` : ''}`
              : `Votre déclaration d'événement (${this.eventTypeLabel(updated.type)} du ${updated.eventDate.toISOString().slice(0, 10)}) a été refusée par la RH.${rhComment ? ` Commentaire : ${rhComment}` : ''}`,
        });
      }

      return eventRow;
    });
  }

  private async ensureActiveEmployee(
    client: PrismaClientLike,
    employeeId: string,
  ) {
    const employee = await client.user.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        matricule: true,
        nom: true,
        prenom: true,
        sexe: true,
        status: true,
      },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (employee.status === UserStatus.INACTIVE) {
      throw new BadRequestException('Employé inactif');
    }
    return employee;
  }

  private async ensureSpecialLeaveType(
    client: PrismaClientLike,
    leaveTypeId?: string,
  ) {
    const leaveType = leaveTypeId
      ? await client.leaveType.findUnique({
          where: { id: leaveTypeId },
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            defaultDays: true,
            active: true,
          },
        })
      : await client.leaveType.findFirst({
          where: { active: true, category: LeaveCategory.CONGE_SPECIAL },
          orderBy: [{ code: 'asc' }],
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            defaultDays: true,
            active: true,
          },
        });

    if (
      !leaveType ||
      leaveType.category !== LeaveCategory.CONGE_SPECIAL ||
      !leaveType.active
    ) {
      throw new NotFoundException('Type de congé spécial introuvable');
    }

    return leaveType;
  }

  private async resolveEventLeaveType(
    client: PrismaClientLike,
    leaveTypeId: string | undefined,
    eventLabel: string,
    sexe: Sexe,
  ): Promise<EventLeaveType> {
    if (leaveTypeId) {
      const leaveType = await client.leaveType.findUnique({
        where: { id: leaveTypeId },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
          active: true,
        },
      });
      if (
        !leaveType ||
        !leaveType.active ||
        !this.isEventLeaveCategory(leaveType.category)
      ) {
        throw new NotFoundException('Type de conge evenementiel introuvable');
      }
      return leaveType;
    }

    const preferredCode = this.preferredLeaveTypeCodeForEvent(eventLabel, sexe);
    const preferred = await client.leaveType.findUnique({
      where: { code: preferredCode },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        defaultDays: true,
        active: true,
      },
    });

    if (
      preferred &&
      preferred.active &&
      this.isEventLeaveCategory(preferred.category)
    ) {
      return preferred;
    }

    return this.ensureSpecialLeaveType(client);
  }

  private preferredLeaveTypeCodeForEvent(eventLabel: string, sexe: Sexe) {
    const kind = this.resolveEventKind(eventLabel);
    if (kind === 'birth') return sexe === Sexe.F ? 'MAT' : 'PAT';
    if (kind === 'illness') return 'MAL';
    return 'SPE';
  }

  private async computeEventSchedule(
    client: PrismaClientLike,
    params: {
      eventLabel: string;
      leaveType: EventLeaveType;
      sexe: Sexe;
      startDate: string | Date;
    },
  ) {
    const startDate =
      params.startDate instanceof Date
        ? params.startDate
        : this.parseDate(params.startDate, 'Date de debut invalide');
    const days = this.resolveEventDays(params);
    const holidays = await this.findHolidaysForSchedule(
      client,
      startDate,
      days,
    );
    const endDate = endDateForWorkingDays(startDate, days, holidays);

    return {
      startDate,
      endDate,
      days: this.roundDays(days),
    };
  }

  private resolveEventDays(params: {
    eventLabel: string;
    leaveType: EventLeaveType;
    sexe: Sexe;
  }) {
    const kind = this.resolveEventKind(params.eventLabel);
    const code = params.leaveType.code.trim().toUpperCase();
    const configuredDays = this.roundDays(params.leaveType.defaultDays);

    if (kind === 'birth') {
      const fallback = BIRTH_LEAVE_FALLBACK_DAYS[params.sexe];
      if ((code === 'MAT' || code === 'PAT') && configuredDays > 0) {
        return configuredDays;
      }
      return fallback;
    }

    if (kind === 'marriage') return SPECIAL_EVENT_FALLBACK_DAYS.marriage;
    if (kind === 'death') return SPECIAL_EVENT_FALLBACK_DAYS.death;
    if (kind === 'illness') {
      return configuredDays > 0
        ? configuredDays
        : SPECIAL_EVENT_FALLBACK_DAYS.illness;
    }

    return SPECIAL_EVENT_FALLBACK_DAYS.other;
  }

  private async findHolidaysForSchedule(
    client: PrismaClientLike,
    startDate: Date,
    days: number,
  ) {
    const maxCalendarDays = Math.max(Math.ceil(days * 2 + 14), 14);
    const endSearch = new Date(startDate);
    endSearch.setUTCDate(endSearch.getUTCDate() + maxCalendarDays);

    return client.publicHoliday.findMany({
      where: {
        country: 'CM',
        OR: [{ recurring: true }, { date: { gte: startDate, lte: endSearch } }],
      },
      select: { date: true, recurring: true },
    });
  }

  private async findExistingImportedRequest(
    client: PrismaClientLike,
    params: {
      employeeId: string;
      eventLabel: string;
      startDate: Date;
    },
  ) {
    const eventLabel = params.eventLabel.trim();
    return client.leaveRequest.findFirst({
      where: {
        ownerId: params.employeeId,
        startDate: params.startDate,
        status: { not: LeaveRequestStatus.CANCELLED },
        leaveType: { category: { in: [...EVENT_LEAVE_CATEGORIES] } },
        ...(eventLabel ? { reason: { startsWith: eventLabel } } : {}),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        days: true,
        status: true,
        leaveType: { select: { code: true } },
      },
    });
  }

  private async syncBalanceForLeaveType(
    client: PrismaClientLike,
    userId: string,
    year: number,
    leaveType: { id: string; code: string; category: LeaveCategory },
  ) {
    const code = leaveType.code.trim().toUpperCase();
    if (leaveType.category === LeaveCategory.CONGE_SPECIAL) {
      await this.syncSpecialBalance(client, userId, year, leaveType.id);
      return;
    }

    if (
      code === 'MAT' ||
      code === 'PAT' ||
      leaveType.category === LeaveCategory.CONGE_MATERNITE ||
      leaveType.category === LeaveCategory.CONGE_PATERNITE
    ) {
      await this.syncBirthLeaveBalances(client, userId, year);
      return;
    }

    await this.syncSingleLeaveTypeBalance(client, userId, year, leaveType.id);
  }

  private async syncBalanceForLeaveTypeForPeriod(
    client: PrismaClientLike,
    userId: string,
    startDate: Date,
    endDate: Date,
    leaveType: { id: string; code: string; category: LeaveCategory },
  ) {
    await Promise.all(
      getLeaveYearsForPeriod(startDate, endDate).map((year) =>
        this.syncBalanceForLeaveType(client, userId, year, leaveType),
      ),
    );
  }

  private async syncSingleLeaveTypeBalance(
    client: PrismaClientLike,
    userId: string,
    year: number,
    leaveTypeId: string,
  ) {
    const range = getLeaveYearRange(year);
    const [user, leaveType, requests, holidays] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          sexe: true,
          dateEmbauche: true,
          passifInitial: true,
          children: { select: { dateNaissance: true } },
          events: { select: { type: true, eventDate: true, processed: true } },
        },
      }),
      client.leaveType.findUnique({
        where: { id: leaveTypeId },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
      client.leaveRequest.findMany({
        where: {
          ownerId: userId,
          leaveTypeId,
          startDate: { lt: range.endExclusive },
          endDate: { gte: range.start },
        },
        select: {
          startDate: true,
          endDate: true,
          status: true,
          submittedAt: true,
        },
      }),
      this.findHolidaysForLeaveYear(client, year),
    ]);

    if (!user || !leaveType) return;
    await this.upsertLeaveTypeBalance({
      client,
      user,
      leaveType,
      year,
      requests,
      holidays,
    });
  }

  private async syncSpecialBalance(
    client: PrismaClientLike,
    userId: string,
    year: number,
    leaveTypeId: string,
  ) {
    const range = getLeaveYearRange(year);
    const [user, leaveType, requests, holidays] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          sexe: true,
          dateEmbauche: true,
          passifInitial: true,
          children: { select: { dateNaissance: true } },
          events: { select: { type: true, eventDate: true, processed: true } },
        },
      }),
      client.leaveType.findUnique({
        where: { id: leaveTypeId },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
      client.leaveRequest.findMany({
        where: {
          ownerId: userId,
          startDate: { lt: range.endExclusive },
          endDate: { gte: range.start },
          leaveType: { category: LeaveCategory.CONGE_SPECIAL },
        },
        select: {
          startDate: true,
          endDate: true,
          status: true,
          submittedAt: true,
        },
      }),
      this.findHolidaysForLeaveYear(client, year),
    ]);

    if (!user || !leaveType) return;
    await this.upsertLeaveTypeBalance({
      client,
      user,
      leaveType,
      year,
      requests,
      holidays,
    });
  }

  private async upsertLeaveTypeBalance(params: {
    client: PrismaClientLike;
    user: {
      id: string;
      sexe: Sexe;
      dateEmbauche: Date;
      passifInitial: number;
      children: { dateNaissance: Date }[];
      events: { type: EventType; eventDate: Date; processed: boolean }[];
    };
    leaveType: {
      id: string;
      code: string;
      name: string;
      category: LeaveCategory;
      defaultDays: number;
    };
    year: number;
    requests: {
      startDate: Date;
      endDate: Date;
      status: LeaveRequestStatus;
      submittedAt: Date | null;
    }[];
    holidays: { date: Date; recurring: boolean }[];
  }) {
    const { client, user, leaveType, year, requests, holidays } = params;
    const takenAdjustment = await this.getTakenAdjustment(
      client,
      user.id,
      leaveType.id,
      year,
    );
    const taken = this.toNumber(
      requests
        .filter((request) => this.isTakenRequest(request, this.todayUtc()))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, year, holidays),
          0,
        ) + takenAdjustment,
    );
    const scheduled = this.toNumber(
      requests
        .filter((request) => this.isScheduledRequest(request, this.todayUtc()))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, year, holidays),
          0,
        ),
    );

    await client.leaveBalance.upsert({
      where: {
        userId_leaveTypeId_year: {
          userId: user.id,
          leaveTypeId: leaveType.id,
          year,
        },
      },
      create: {
        userId: user.id,
        leaveTypeId: leaveType.id,
        year,
        acquired: this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year,
        }),
        carryover: 0,
        taken,
        takenAdjustment,
        scheduled,
      },
      update: {
        acquired: this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year,
        }),
        taken,
        scheduled,
      },
    });
  }

  private async syncBirthEventDecisionAndBalances(
    client: PrismaClientLike,
    request: SpecialLeaveRecord,
  ) {
    if (!this.isBirthEventLabel(this.extractEventLabel(request.reason))) {
      return;
    }

    const shouldBeProcessed = request.status === LeaveRequestStatus.APPROVED;
    const event = await client.event.findFirst({
      where: {
        userId: request.ownerId,
        type: EventType.BIRTH,
        eventDate: request.startDate,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: { id: true, processed: true, status: true },
    });

    if (event) {
      const eventStatus = shouldBeProcessed
        ? LeaveRequestStatus.APPROVED
        : LeaveRequestStatus.PENDING;
      if (
        event.processed !== shouldBeProcessed ||
        event.status !== eventStatus
      ) {
        await client.event.update({
          where: { id: event.id },
          data: { processed: shouldBeProcessed, status: eventStatus },
          select: { id: true },
        });
      }
    } else {
      await client.event.create({
        data: {
          userId: request.ownerId,
          type: EventType.BIRTH,
          eventDate: request.startDate,
          description: `Import RH ${request.reference}`,
          processed: shouldBeProcessed,
          status: shouldBeProcessed
            ? LeaveRequestStatus.APPROVED
            : LeaveRequestStatus.PENDING,
        },
        select: { id: true },
      });
    }

    if (shouldBeProcessed) {
      await this.ensureChildFromBirthEvent(
        client,
        request.ownerId,
        request.startDate,
      );
    }

    await this.syncBirthLeaveBalancesForPeriod(
      client,
      request.ownerId,
      request.startDate,
      request.endDate,
    );
  }

  private async syncBirthLeaveBalancesForPeriod(
    client: PrismaClientLike,
    userId: string,
    startDate: Date,
    endDate: Date,
  ) {
    await Promise.all(
      getLeaveYearsForPeriod(startDate, endDate).map((year) =>
        this.syncBirthLeaveBalances(client, userId, year),
      ),
    );
  }

  private async syncBirthLeaveBalances(
    client: PrismaClientLike,
    userId: string,
    year: number,
  ) {
    const [user, leaveTypes] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          sexe: true,
          dateEmbauche: true,
          passifInitial: true,
          children: { select: { dateNaissance: true } },
          events: { select: { type: true, eventDate: true, processed: true } },
        },
      }),
      client.leaveType.findMany({
        where: { active: true, code: { in: ['PAT', 'MAT', 'ENF'] } },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
    ]);

    if (!user || leaveTypes.length === 0) return;

    await Promise.all(
      leaveTypes.map(async (leaveType) => {
        const range = getLeaveYearRange(year);
        const [requests, holidays] = await Promise.all([
          client.leaveRequest.findMany({
            where: {
              ownerId: userId,
              leaveTypeId: leaveType.id,
              startDate: { lt: range.endExclusive },
              endDate: { gte: range.start },
            },
            select: {
              startDate: true,
              endDate: true,
              status: true,
              submittedAt: true,
            },
          }),
          this.findHolidaysForLeaveYear(client, year),
        ]);
        const takenAdjustment = await this.getTakenAdjustment(
          client,
          userId,
          leaveType.id,
          year,
        );
        const taken = this.toNumber(
          requests
            .filter((request) => this.isTakenRequest(request, this.todayUtc()))
            .reduce(
              (total, request) =>
                total + this.daysInLeaveYear(request, year, holidays),
              0,
            ) + takenAdjustment,
        );
        const scheduled = this.toNumber(
          requests
            .filter((request) =>
              this.isScheduledRequest(request, this.todayUtc()),
            )
            .reduce(
              (total, request) =>
                total + this.daysInLeaveYear(request, year, holidays),
              0,
            ),
        );

        await client.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId,
              leaveTypeId: leaveType.id,
              year,
            },
          },
          create: {
            userId,
            leaveTypeId: leaveType.id,
            year,
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year,
            }),
            carryover: 0,
            taken,
            takenAdjustment,
            scheduled,
          },
          update: {
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year,
            }),
            taken,
            scheduled,
          },
        });
      }),
    );
  }

  private async findHolidaysForLeaveYear(
    client: PrismaClientLike,
    year: number,
  ) {
    const range = getLeaveYearRange(year);
    return client.publicHoliday.findMany({
      where: {
        country: 'CM',
        OR: [
          { recurring: true },
          { date: { gte: range.start, lt: range.endExclusive } },
        ],
      },
      select: { date: true, recurring: true },
    });
  }

  private todayUtc() {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private isTakenRequest(
    request: { status: LeaveRequestStatus; endDate: Date },
    today: Date,
  ) {
    return (
      request.status === LeaveRequestStatus.APPROVED && request.endDate < today
    );
  }

  private isScheduledRequest(
    request: {
      status: LeaveRequestStatus;
      endDate: Date;
      submittedAt: Date | null;
    },
    today: Date,
  ) {
    return (
      (request.status === LeaveRequestStatus.APPROVED &&
        request.endDate >= today) ||
      request.status === LeaveRequestStatus.PENDING ||
      request.status === LeaveRequestStatus.IN_REVIEW ||
      (request.status === LeaveRequestStatus.DRAFT && !request.submittedAt)
    );
  }

  private daysInLeaveYear(
    request: { startDate: Date; endDate: Date },
    year: number,
    holidays: { date: Date; recurring: boolean }[],
  ) {
    return this.toNumber(
      splitPeriodByLeaveYear(request.startDate, request.endDate)
        .filter((segment) => segment.year === year)
        .reduce(
          (total, segment) =>
            total +
            countWorkingDays(segment.startDate, segment.endDate, holidays),
          0,
        ),
    );
  }

  private async getTakenAdjustment(
    client: PrismaClientLike,
    userId: string,
    leaveTypeId: string,
    year: number,
  ) {
    const balance = await client.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: { userId, leaveTypeId, year },
      },
      select: { takenAdjustment: true },
    });

    return this.toNumber(balance?.takenAdjustment ?? 0);
  }

  private isBirthEventLabel(value: string) {
    return this.resolveEventKind(value) === 'birth';
  }

  private resolveEventKind(value: string): SpecialLeaveEventKind {
    const normalized = this.normalizeImportToken(value);

    if (
      normalized.includes('naissance') ||
      normalized.includes('accouchement') ||
      normalized.includes('paternite') ||
      normalized.includes('maternite')
    ) {
      return 'birth';
    }
    if (normalized.includes('mariage')) return 'marriage';
    if (
      normalized.includes('deces') ||
      normalized.includes('deuil') ||
      normalized.includes('funera')
    ) {
      return 'death';
    }
    if (normalized.includes('maladie')) return 'illness';

    return 'other';
  }

  private normalizeImportToken(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private toResponse(
    request: SpecialLeaveRecord,
    balance?: {
      acquired: number;
      carryover: number;
      taken: number;
      scheduled: number;
    },
  ) {
    const status = this.toBadgeStatus(request.status);
    const quotaTotal = this.roundDays(
      (balance?.acquired ?? request.leaveType.defaultDays) +
        (balance?.carryover ?? 0),
    );
    const quotaUsed = this.roundDays(
      (balance?.taken ?? 0) + (balance?.scheduled ?? 0),
    );

    return {
      id: request.id,
      reference: request.reference,
      employeeId: request.ownerId,
      employeeName: this.fullName(request.owner),
      matricule: request.owner.matricule,
      department: request.owner.department?.name ?? 'Sans département',
      leaveTypeId: request.leaveType.id,
      leaveTypeCode: request.leaveType.code,
      eventLabel:
        this.extractEventLabel(request.reason) || request.leaveType.name,
      startDate: request.startDate.toISOString().slice(0, 10),
      endDate: request.endDate.toISOString().slice(0, 10),
      days: this.roundDays(request.days),
      proof: request.attachments.length > 0,
      proofLabel: request.attachments.length > 0 ? 'Oui' : 'Non',
      proofUrl: request.attachments[0]?.url ?? null,
      status: status.tone,
      statusCode: request.status,
      statusLabel: status.label,
      quotaTotal,
      quotaUsed,
      quotaRemaining: this.roundDays(Math.max(quotaTotal - quotaUsed, 0)),
      reason: this.extractReason(request.reason),
      submittedAt: request.submittedAt?.toISOString() ?? null,
      decidedAt: request.decidedAt?.toISOString() ?? null,
    };
  }

  private buildTotals(requests: SpecialLeaveRecord[]) {
    return {
      total: requests.length,
      approved: requests.filter(
        (request) => request.status === LeaveRequestStatus.APPROVED,
      ).length,
      pending: requests.filter(
        (request) =>
          request.status === LeaveRequestStatus.PENDING ||
          request.status === LeaveRequestStatus.IN_REVIEW,
      ).length,
      days: this.roundDays(
        requests
          .filter((request) => request.status === LeaveRequestStatus.APPROVED)
          .reduce((sum, request) => sum + request.days, 0),
      ),
    };
  }

  private buildTotalsFromRows(
    rows: {
      statusCode: LeaveRequestStatus;
      days: number;
    }[],
  ) {
    return {
      total: rows.length,
      approved: rows.filter(
        (row) => row.statusCode === LeaveRequestStatus.APPROVED,
      ).length,
      pending: rows.filter(
        (row) =>
          row.statusCode === LeaveRequestStatus.PENDING ||
          row.statusCode === LeaveRequestStatus.IN_REVIEW,
      ).length,
      days: this.roundDays(
        rows
          .filter((row) => row.statusCode === LeaveRequestStatus.APPROVED)
          .reduce((sum, row) => sum + row.days, 0),
      ),
    };
  }

  private toEventRow(event: EventRowRecord) {
    const status = this.toBadgeStatus(event.status);
    const eventLabel = this.eventTypeLabel(event.type);

    return {
      id: this.toEventRowId(event.id),
      reference: `EVT-${event.eventDate.getUTCFullYear()}-${event.id.slice(-6).toUpperCase()}`,
      employeeId: event.user.id,
      employeeName: this.fullName(event.user),
      matricule: event.user.matricule,
      department: event.user.department?.name ?? 'Sans département',
      leaveTypeId: '',
      leaveTypeCode: 'EVT',
      eventLabel,
      startDate: event.eventDate.toISOString().slice(0, 10),
      endDate: event.eventDate.toISOString().slice(0, 10),
      days: 0,
      proof: Boolean(event.proofUrl),
      proofLabel: event.proofUrl ? 'Oui' : 'Non',
      proofUrl: event.proofUrl,
      status: status.tone,
      statusCode: event.status,
      statusLabel: status.label,
      quotaTotal: 0,
      quotaUsed: 0,
      quotaRemaining: 0,
      reason: this.stripLegacyEventStatusMarker(event.description),
      rhComment: event.rhComment ?? '',
      submittedAt: event.createdAt.toISOString(),
      decidedAt: event.reviewedAt?.toISOString() ?? null,
    };
  }

  private stripLegacyEventStatusMarker(description: string | null | undefined) {
    return (
      description
        ?.replace(/\s*\[RH_STATUS:(APPROVED|REJECTED|CANCELLED)\]\s*$/, '')
        .trim() ?? ''
    );
  }

  private async ensureChildFromBirthEvent(
    client: PrismaClientLike,
    parentId: string,
    birthDate: Date,
  ) {
    const existing = await client.child.findFirst({
      where: {
        parentId,
        dateNaissance: birthDate,
      },
      select: { id: true },
    });

    if (existing) return;

    await client.child.create({
      data: {
        parentId,
        nom: 'ENFANT',
        prenom: 'Nouveau-ne',
        dateNaissance: birthDate,
        sexe: Sexe.M,
      },
      select: { id: true },
    });
  }

  private eventTypeLabel(type: EventType) {
    const labels: Record<EventType, string> = {
      BIRTH: 'Naissance',
      MARRIAGE: 'Mariage',
      DEATH: 'Deces',
      ILLNESS: 'Maladie',
      OTHER: 'Autre',
    };

    return labels[type];
  }

  private toEventRowId(id: string) {
    return `event:${id}`;
  }

  private isEventRowId(id: string) {
    return id.startsWith('event:');
  }

  private parseEventId(rowId: string) {
    const [prefix, id] = rowId.split(':');
    if (prefix !== 'event' || !id) {
      throw new NotFoundException('Événement introuvable');
    }

    return id;
  }

  private toAttachmentCreateData(dto: {
    proofUrl?: string;
    proofFilename?: string;
  }) {
    const attachments = this.toAttachmentCreate(dto);

    return attachments ? { attachments } : {};
  }

  private toAttachmentCreate(dto: {
    proofUrl?: string;
    proofFilename?: string;
  }): Prisma.AttachmentCreateNestedManyWithoutRequestInput | undefined {
    const proofUrl = dto.proofUrl?.trim();
    if (!proofUrl) return undefined;

    return {
      create: {
        url: proofUrl,
        filename: dto.proofFilename?.trim() || 'Justificatif',
      },
    };
  }

  private buildReason(eventLabel: string, reason?: string) {
    const event = eventLabel.trim() || 'Congé spécial';
    const detail = reason?.trim();

    return detail ? `${event} — ${detail}` : event;
  }

  private extractEventLabel(reason: string | null) {
    return reason?.split(' — ')[0]?.trim() ?? '';
  }

  private extractReason(reason: string | null) {
    const parts = reason?.split(' — ') ?? [];
    return parts.slice(1).join(' — ').trim();
  }

  private toBadgeStatus(status: LeaveRequestStatus): {
    tone: BadgeTone;
    label: string;
  } {
    const statusMap: Record<
      LeaveRequestStatus,
      { tone: BadgeTone; label: string }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'draft', label: 'Brouillon' },
      [LeaveRequestStatus.PENDING]: { tone: 'pending', label: 'À confirmer' },
      [LeaveRequestStatus.IN_REVIEW]: { tone: 'pending', label: 'En revue' },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Validé' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusé' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return statusMap[status];
  }

  private async generateReference(client: PrismaClientLike, startDate: Date) {
    const year = getLeaveYear(startDate);
    const count = await client.leaveRequest.count({
      where: {
        reference: { startsWith: `CS-${year}-` },
      },
    });

    return `CS-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private isFinalStatus(status: LeaveRequestStatus) {
    return [
      status === LeaveRequestStatus.APPROVED,
      status === LeaveRequestStatus.REJECTED,
      status === LeaveRequestStatus.CANCELLED,
    ].some(Boolean);
  }

  private parseYear(value: string | undefined) {
    if (!value) return getCurrentLeaveYear();

    const year = Number(value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('Année invalide');
    }

    return year;
  }

  private parseDate(value: string, message: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(message);

    return date;
  }

  private ensureDateRange(startDate: Date, endDate: Date) {
    if (endDate < startDate) {
      throw new BadRequestException(
        'La date de fin doit être après la date de début',
      );
    }
  }

  private isEventLeaveCategory(category: LeaveCategory) {
    return (EVENT_LEAVE_CATEGORIES as readonly LeaveCategory[]).includes(
      category,
    );
  }

  private balanceMapKey(userId: string, leaveTypeId: string) {
    return `${userId}:${leaveTypeId}`;
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private toNumber(value: number | null | undefined) {
    return this.roundDays(value ?? 0);
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
