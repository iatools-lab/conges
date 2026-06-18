import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  Sexe,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { EmailService } from '../../shared/notifications/email.service';
import {
  CreateRhSpecialLeaveDto,
  UpdateRhSpecialLeaveDto,
} from './dto/rh-special-leave.dto';
import {
  fieldDateWhere,
  overlapDateWhere,
  resolveDateRange,
} from '../../../common/date-range';

type BadgeTone = 'valid' | 'pending' | 'rejected' | 'draft' | 'neutral';
type PrismaClientLike = PrismaService | Prisma.TransactionClient;
const EVENT_STATUS_MARKER =
  /\s*\[RH_STATUS:(APPROVED|REJECTED|CANCELLED)\]\s*$/;

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

  async findAll(filters: {
    year?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}) {
    const range = resolveDateRange(filters, { defaultMode: 'year' });
    const year = range.year;
    const eventDate = fieldDateWhere(range);

    const [requests, balances, events] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          ...overlapDateWhere(range),
          leaveType: { category: LeaveCategory.CONGE_SPECIAL },
        },
        orderBy: [{ startDate: 'desc' }, { reference: 'desc' }],
        select: specialLeaveSelect,
      }),
      this.prisma.leaveBalance.findMany({
        where: { year, leaveType: { category: LeaveCategory.CONGE_SPECIAL } },
        select: {
          userId: true,
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
      balances.map((balance) => [balance.userId, balance]),
    );

    const requestRows = requests.map((request) =>
      this.toResponse(request, balanceByUser.get(request.ownerId)),
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
      await this.ensureActiveEmployee(transaction, dto.employeeId);
      const leaveType = await this.ensureSpecialLeaveType(
        transaction,
        dto.leaveTypeId,
      );
      const startDate = this.parseDate(dto.startDate, 'Date de début invalide');
      const endDate = this.parseDate(dto.endDate, 'Date de fin invalide');
      this.ensureDateRange(startDate, endDate);
      const status = dto.status ?? LeaveRequestStatus.APPROVED;

      const request = await transaction.leaveRequest.create({
        data: {
          reference: await this.generateReference(transaction, startDate),
          ownerId: dto.employeeId,
          leaveTypeId: leaveType.id,
          startDate,
          endDate,
          days: this.roundDays(dto.days),
          reason: this.buildReason(dto.eventLabel, dto.reason),
          status,
          submittedAt: new Date(),
          decidedAt: this.isFinalStatus(status) ? new Date() : null,
          ...this.toAttachmentCreateData(dto),
        },
        select: specialLeaveSelect,
      });

      await this.syncSpecialBalance(
        transaction,
        request.ownerId,
        startDate.getUTCFullYear(),
        leaveType.id,
      );
      await this.syncBirthEventDecisionAndBalances(transaction, request);

      return this.toResponse(request);
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
        leaveTypeId: true,
        leaveType: { select: { category: true } },
      },
    });
    if (
      !existing ||
      existing.leaveType.category !== LeaveCategory.CONGE_SPECIAL
    ) {
      throw new NotFoundException('Congé spécial introuvable');
    }

    const notificationStatus = dto.status;
    const notificationEmployeeId = existing.ownerId;

    const updated = await this.prisma.$transaction(async (transaction) => {
      const data: Prisma.LeaveRequestUpdateInput = {};
      let leaveTypeId = existing.leaveTypeId;

      if (dto.employeeId !== undefined) {
        await this.ensureActiveEmployee(transaction, dto.employeeId);
        data.owner = { connect: { id: dto.employeeId } };
      }
      if (dto.leaveTypeId !== undefined) {
        const leaveType = await this.ensureSpecialLeaveType(
          transaction,
          dto.leaveTypeId,
        );
        data.leaveType = { connect: { id: leaveType.id } };
        leaveTypeId = leaveType.id;
      }
      if (dto.startDate !== undefined)
        data.startDate = this.parseDate(
          dto.startDate,
          'Date de début invalide',
        );
      if (dto.endDate !== undefined)
        data.endDate = this.parseDate(dto.endDate, 'Date de fin invalide');
      if (dto.days !== undefined) data.days = this.roundDays(dto.days);
      if (dto.eventLabel !== undefined || dto.reason !== undefined) {
        data.reason = this.buildReason(
          dto.eventLabel ?? 'Congé spécial',
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
        this.syncSpecialBalance(
          transaction,
          existing.ownerId,
          existing.startDate.getUTCFullYear(),
          existing.leaveTypeId,
        ),
        this.syncSpecialBalance(
          transaction,
          request.ownerId,
          request.startDate.getUTCFullYear(),
          leaveTypeId,
        ),
      ]);

      await Promise.all([
        this.syncBirthEventDecisionAndBalances(transaction, request),
        existing.id === request.id &&
        (existing.ownerId !== request.ownerId ||
          existing.startDate.getUTCFullYear() !==
            request.startDate.getUTCFullYear())
          ? this.syncBirthLeaveBalances(
              transaction,
              existing.ownerId,
              existing.startDate.getUTCFullYear(),
            )
          : Promise.resolve(),
      ]);

      return this.toResponse(request) as ReturnType<typeof this.toResponse>;
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
        status !== LeaveRequestStatus.APPROVED &&
        status !== LeaveRequestStatus.REJECTED &&
        status !== LeaveRequestStatus.CANCELLED
      ) {
        throw new BadRequestException(
          'Pour un événement, seules les actions Valider ou Refuser sont autorisées',
        );
      }

      const processed =
        status === LeaveRequestStatus.APPROVED
          ? true
          : status === LeaveRequestStatus.REJECTED ||
              status === LeaveRequestStatus.CANCELLED
            ? false
            : event.processed;
      const eventStatus =
        status ??
        (processed ? LeaveRequestStatus.APPROVED : LeaveRequestStatus.PENDING);

      const updated = await transaction.event.update({
        where: { id: event.id },
        data: {
          processed,
          description: this.withEventStatusMarker(
            event.description,
            eventStatus,
          ),
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

      await this.syncBirthLeaveBalances(
        transaction,
        updated.user.id,
        updated.eventDate.getUTCFullYear(),
      );

      const eventRow = this.toEventRow(updated);

      // Notify employee by email
      if (status !== undefined && updated.user.email) {
        const approved = status === LeaveRequestStatus.APPROVED;
        await this.emailService.send({
          to: updated.user.email,
          link: '/declarer',
          actionLabel: 'Voir mes declarations',
          subject: approved
            ? `Événement validé — ${this.eventTypeLabel(updated.type)}`
            : `Événement refusé — ${this.eventTypeLabel(updated.type)}`,
          text: approved
            ? `Votre déclaration d'événement (${this.eventTypeLabel(updated.type)} du ${updated.eventDate.toISOString().slice(0, 10)}) a été validée par la RH.`
            : `Votre déclaration d'événement (${this.eventTypeLabel(updated.type)} du ${updated.eventDate.toISOString().slice(0, 10)}) a été refusée par la RH.`,
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
      select: { id: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
    if (employee.status === UserStatus.INACTIVE) {
      throw new BadRequestException('Employé inactif');
    }
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

  private async syncSpecialBalance(
    client: PrismaClientLike,
    userId: string,
    year: number,
    leaveTypeId: string,
  ) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const [user, leaveType, approved, scheduled] = await Promise.all([
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
      client.leaveRequest.aggregate({
        where: {
          ownerId: userId,
          startDate: { gte: yearStart, lt: nextYearStart },
          status: LeaveRequestStatus.APPROVED,
          leaveType: { category: LeaveCategory.CONGE_SPECIAL },
        },
        _sum: { days: true },
      }),
      client.leaveRequest.aggregate({
        where: {
          ownerId: userId,
          startDate: { gte: yearStart, lt: nextYearStart },
          status: {
            in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
          },
          leaveType: { category: LeaveCategory.CONGE_SPECIAL },
        },
        _sum: { days: true },
      }),
    ]);

    if (!user || !leaveType) return;

    await client.leaveBalance.upsert({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
      create: {
        userId,
        leaveTypeId,
        year,
        acquired: this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year,
        }),
        carryover: 0,
        taken: this.toNumber(approved._sum.days),
        scheduled: this.toNumber(scheduled._sum.days),
      },
      update: {
        taken: this.toNumber(approved._sum.days),
        scheduled: this.toNumber(scheduled._sum.days),
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

    const event = await client.event.findFirst({
      where: {
        userId: request.ownerId,
        type: EventType.BIRTH,
        processed:
          request.status === LeaveRequestStatus.APPROVED ? false : undefined,
      },
      orderBy: [{ createdAt: 'desc' }],
      select: { id: true, processed: true },
    });

    if (event) {
      const shouldBeProcessed = request.status === LeaveRequestStatus.APPROVED;
      if (event.processed !== shouldBeProcessed) {
        await client.event.update({
          where: { id: event.id },
          data: { processed: shouldBeProcessed },
          select: { id: true },
        });
      }
    }

    await this.syncBirthLeaveBalances(
      client,
      request.ownerId,
      request.startDate.getUTCFullYear(),
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
        const yearStart = new Date(Date.UTC(year, 0, 1));
        const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
        const [approved, scheduled] = await Promise.all([
          client.leaveRequest.aggregate({
            where: {
              ownerId: userId,
              leaveTypeId: leaveType.id,
              startDate: { gte: yearStart, lt: nextYearStart },
              status: LeaveRequestStatus.APPROVED,
            },
            _sum: { days: true },
          }),
          client.leaveRequest.aggregate({
            where: {
              ownerId: userId,
              leaveTypeId: leaveType.id,
              startDate: { gte: yearStart, lt: nextYearStart },
              status: {
                in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
              },
            },
            _sum: { days: true },
          }),
        ]);

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
            taken: this.toNumber(approved._sum.days),
            scheduled: this.toNumber(scheduled._sum.days),
          },
          update: {
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year,
            }),
            taken: this.toNumber(approved._sum.days),
            scheduled: this.toNumber(scheduled._sum.days),
          },
        });
      }),
    );
  }

  private isBirthEventLabel(value: string) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    return normalized.includes('naissance');
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
    const mappedStatus =
      this.extractEventStatusMarker(event.description) ??
      (event.processed
        ? LeaveRequestStatus.APPROVED
        : LeaveRequestStatus.PENDING);
    const status = this.toBadgeStatus(mappedStatus);
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
      status: status.tone,
      statusCode: mappedStatus,
      statusLabel: status.label,
      quotaTotal: 0,
      quotaUsed: 0,
      quotaRemaining: 0,
      reason: this.stripEventStatusMarker(event.description),
      rhComment: '',
      submittedAt: event.createdAt.toISOString(),
      decidedAt:
        mappedStatus === LeaveRequestStatus.APPROVED ||
        mappedStatus === LeaveRequestStatus.REJECTED ||
        mappedStatus === LeaveRequestStatus.CANCELLED
          ? event.createdAt.toISOString()
          : null,
    };
  }

  private withEventStatusMarker(
    description: string | null | undefined,
    status: LeaveRequestStatus,
  ) {
    const stripped = this.stripEventStatusMarker(description);
    if (
      status !== LeaveRequestStatus.APPROVED &&
      status !== LeaveRequestStatus.REJECTED &&
      status !== LeaveRequestStatus.CANCELLED
    ) {
      return stripped || null;
    }

    return `${stripped}${stripped ? ' ' : ''}[RH_STATUS:${status}]`;
  }

  private extractEventStatusMarker(
    description: string | null | undefined,
  ): LeaveRequestStatus | null {
    const match = description?.match(EVENT_STATUS_MARKER);
    if (!match) return null;

    const status = match[1];
    if (status === LeaveRequestStatus.APPROVED)
      return LeaveRequestStatus.APPROVED;
    if (status === LeaveRequestStatus.REJECTED)
      return LeaveRequestStatus.REJECTED;
    if (status === LeaveRequestStatus.CANCELLED)
      return LeaveRequestStatus.CANCELLED;

    return null;
  }

  private stripEventStatusMarker(description: string | null | undefined) {
    return description?.replace(EVENT_STATUS_MARKER, '').trim() ?? '';
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
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'À revoir' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return statusMap[status];
  }

  private async generateReference(client: PrismaClientLike, startDate: Date) {
    const year = startDate.getUTCFullYear();
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
    if (!value) return new Date().getUTCFullYear();

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
