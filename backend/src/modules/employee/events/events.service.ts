import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  EventType,
  LeaveRequestStatus,
  NotificationType,
  Prisma,
  RoleType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateEmployeeEventDto,
  DeleteEmployeeEventDto,
  FindEmployeeEventsQueryDto,
  ReviewEmployeeEventDto,
  UpdateEmployeeEventDto,
} from './dto/employee-event.dto';
import { EmailService } from '../../shared/notifications/email.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { fieldDateWhere, resolveDateRange } from '../../../common/date-range';
import {
  getLeaveYear,
  getLeaveYearRange,
  splitPeriodByLeaveYear,
} from '../../../common/leave-year';
import { countWorkingDays } from '../../../common/working-days';
import {
  EXCEPTIONAL_PERMISSION_RULES,
  findExceptionalPermissionRule,
} from '../../shared/special-leaves/exceptional-permissions';

export const EVENT_PROOF_MAX_BYTES = 3 * 1024 * 1024;

export type UploadedEventProof = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const eventSelect = {
  id: true,
  type: true,
  eventDate: true,
  description: true,
  proofUrl: true,
  status: true,
  rhComment: true,
  reviewedAt: true,
  processed: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

@Injectable()
export class EmployeeEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
  ) {}

  async findAll(query: FindEmployeeEventsQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const range = resolveDateRange(query, { defaultMode: 'all' });
    const eventDate = fieldDateWhere(range);
    const events = await this.prisma.event.findMany({
      where: {
        userId: user.id,
        ...(eventDate ? { eventDate } : {}),
      },
      orderBy: [{ eventDate: 'desc' }, { createdAt: 'desc' }],
      take: query.limit ?? 10,
      select: eventSelect,
    });

    return {
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      user: this.toUser(user),
      eventTypes: this.buildEventTypeOptions(),
      rows: events.map((event) => this.toResponse(event)),
    };
  }

  async create(dto: CreateEmployeeEventDto, proof?: UploadedEventProof) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const declaredEventDate = this.parseDate(dto.eventDate);
    const eventDate =
      dto.type === EventType.BIRTH
        ? this.parseBirthEventDate(dto.childBirthDate ?? dto.eventDate)
        : declaredEventDate;
    const proofUrl = this.toProofDataUrl(proof);
    const description = dto.description?.trim() || null;

    const { event, emails } = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.event.create({
          data: {
            userId: user.id,
            type: dto.type,
            eventDate,
            description,
            proofUrl,
            status: LeaveRequestStatus.PENDING,
            rhComment: null,
            reviewedAt: null,
            processed: false,
          },
          select: eventSelect,
        });

        await transaction.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CREATE,
            entity: 'Event',
            entityId: created.id,
            metadata: {
              source: 'employee',
              type: dto.type,
              proof: Boolean(proofUrl),
              eventDate: this.toDateInput(eventDate),
              declarationDate: this.toDateInput(declaredEventDate),
            },
          },
        });

        const rhUsers = await transaction.user.findMany({
          where: {
            status: { not: UserStatus.INACTIVE },
            roles: { some: { role: RoleType.RH } },
          },
          select: { id: true, email: true },
        });
        const n1Users = user.n1Id
          ? await transaction.user.findMany({
              where: {
                id: user.n1Id,
                status: { not: UserStatus.INACTIVE },
              },
              select: { id: true, email: true },
            })
          : [];
        const rhUserIds = new Set(rhUsers.map((rhUser) => rhUser.id));
        const n1UsersToNotify = n1Users.filter(
          (n1User) => n1User.id !== user.id && !rhUserIds.has(n1User.id),
        );

        if (rhUsers.length > 0) {
          await transaction.notification.createMany({
            data: rhUsers.map((rhUser) => ({
              userId: rhUser.id,
              type: NotificationType.SYSTEM,
              title: 'Nouvel événement déclaré',
              description: `${this.fullName(user)} — ${this.eventLabel(dto.type)}`,
              link: '/rh/speciaux',
            })),
          });
        }
        if (n1UsersToNotify.length > 0) {
          await transaction.notification.createMany({
            data: n1UsersToNotify.map((n1User) => ({
              userId: n1User.id,
              type: NotificationType.SYSTEM,
              title: 'Evenement declare par un collaborateur',
              description: `${this.fullName(user)} - ${this.eventLabel(dto.type)}`,
              link: '/manager',
            })),
          });
        }

        const emails = rhUsers
          .filter((rhUser) => Boolean(rhUser.email))
          .map((rhUser) => ({
            to: rhUser.email,
            subject: 'Nouvel evenement declare',
            text: `${this.fullName(user)} a declare ${this.eventLabel(dto.type)} pour le ${this.toDateInput(eventDate)}.`,
            link: '/rh/speciaux',
            actionLabel: 'Traiter la declaration',
          }));
        const n1Emails = n1UsersToNotify
          .filter((n1User) => Boolean(n1User.email))
          .map((n1User) => ({
            to: n1User.email,
            subject: 'Evenement declare par un collaborateur',
            text: `${this.fullName(user)} a declare ${this.eventLabel(dto.type)} pour le ${this.toDateInput(eventDate)}.`,
            link: '/manager',
            actionLabel: 'Ouvrir le tableau de bord',
          }));

        return { event: created, emails: [...emails, ...n1Emails] };
      },
    );

    await this.emailService.sendMany(emails);

    return this.toResponse(event);
  }

  async update(
    id: string,
    dto: UpdateEmployeeEventDto,
    proof?: UploadedEventProof,
  ) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.prisma.event.findUnique({
      where: { id },
      select: { ...eventSelect, userId: true },
    });

    if (!existing || existing.userId !== user.id) {
      throw new NotFoundException('Evénement introuvable');
    }
    if (
      existing.status === LeaveRequestStatus.APPROVED ||
      existing.status === LeaveRequestStatus.IN_REVIEW
    ) {
      throw new BadRequestException(
        "Une déclaration validée ou en revue RH ne peut plus être modifiée depuis l'espace employé.",
      );
    }

    const nextType = dto.type ?? existing.type;
    const declaredEventDate = dto.eventDate
      ? this.parseDate(dto.eventDate)
      : existing.eventDate;
    const nextEventDate =
      nextType === EventType.BIRTH
        ? this.parseBirthEventDate(
            dto.childBirthDate ??
              dto.eventDate ??
              this.toDateInput(existing.eventDate),
          )
        : declaredEventDate;
    const nextProofUrl = proof ? this.toProofDataUrl(proof) : existing.proofUrl;
    const nextDescription =
      dto.description !== undefined
        ? dto.description.trim() || null
        : existing.description;

    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.event.update({
        where: { id },
        data: {
          type: nextType,
          eventDate: nextEventDate,
          description: nextDescription,
          proofUrl: nextProofUrl,
          status: LeaveRequestStatus.PENDING,
          processed: false,
          rhComment: null,
          reviewedAt: null,
        },
        select: eventSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.UPDATE,
          entity: 'Event',
          entityId: id,
          metadata: {
            source: 'employee',
            previousStatus: existing.status,
            type: nextType,
            proof: Boolean(nextProofUrl),
            eventDate: this.toDateInput(nextEventDate),
          },
        },
      });

      return row;
    });

    return this.toResponse(updated);
  }

  async remove(id: string, dto: DeleteEmployeeEventDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.prisma.event.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });

    if (!existing || existing.userId !== user.id) {
      throw new NotFoundException('Evénement introuvable');
    }
    if (
      existing.status === LeaveRequestStatus.APPROVED ||
      existing.status === LeaveRequestStatus.IN_REVIEW
    ) {
      throw new BadRequestException(
        "Une déclaration validée ou en revue RH ne peut pas être supprimée depuis l'espace employé.",
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.event.delete({ where: { id } });
      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: AuditAction.DELETE,
          entity: 'Event',
          entityId: id,
          metadata: { source: 'employee', previousStatus: existing.status },
        },
      });
    });

    return { id, deleted: true };
  }

  async review(id: string, dto: ReviewEmployeeEventDto) {
    const rhUser = await this.resolveRh(dto.rhId, dto.rhEmail);

    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.event.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          type: true,
          eventDate: true,
          processed: true,
          user: {
            select: {
              id: true,
              email: true,
              nom: true,
              prenom: true,
              status: true,
              sexe: true,
              dateEmbauche: true,
              passifInitial: true,
              children: { select: { dateNaissance: true } },
              events: {
                select: { type: true, eventDate: true, processed: true },
              },
            },
          },
        },
      });

      if (!event || event.user.status === UserStatus.INACTIVE) {
        throw new NotFoundException('Événement introuvable');
      }

      const status =
        dto.status ??
        (dto.approved === true
          ? LeaveRequestStatus.APPROVED
          : dto.approved === false
            ? LeaveRequestStatus.REJECTED
            : null);
      if (
        status !== LeaveRequestStatus.IN_REVIEW &&
        status !== LeaveRequestStatus.APPROVED &&
        status !== LeaveRequestStatus.REJECTED
      ) {
        throw new BadRequestException('Décision RH invalide');
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
        where: { id },
        data: {
          processed,
          status,
          rhComment,
          reviewedAt: new Date(),
        },
        select: eventSelect,
      });

      await this.syncEventBalances(
        transaction,
        event.user,
        getLeaveYear(event.eventDate),
      );

      await transaction.auditLog.create({
        data: {
          userId: rhUser.id,
          action: AuditAction.UPDATE,
          entity: 'Event',
          entityId: event.id,
          metadata: {
            source: 'rh',
            decision: status,
            comment: rhComment,
            type: event.type,
            ownerId: event.userId,
          },
        },
      });

      if (event.userId !== rhUser.id) {
        await transaction.notification.create({
          data: {
            userId: event.userId,
            type: NotificationType.SYSTEM,
            title: 'Déclaration événement mise à jour',
            description:
              status === LeaveRequestStatus.APPROVED
                ? 'Votre déclaration a été validée par la RH.'
                : status === LeaveRequestStatus.IN_REVIEW
                  ? 'Votre déclaration a été mise en revue par la RH.'
                  : 'Votre déclaration a été rejetée par la RH.',
            link: '/declarer',
          },
        });
      }

      return this.toResponse(updated);
    });
  }

  private parseBirthEventDate(value: string) {
    const date = this.parseDate(value);
    if (date > new Date()) {
      throw new BadRequestException(
        "La date de naissance de l'enfant ne peut pas être dans le futur",
      );
    }

    return date;
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
        n1Id: true,
        status: true,
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private parseDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date invalide');
    }

    return date;
  }

  private toProofDataUrl(proof?: UploadedEventProof) {
    if (!proof) return null;
    if (!allowedImageTypes.has(proof.mimetype)) {
      throw new BadRequestException(
        'Le justificatif doit être une image ou un fichier PDF',
      );
    }
    if (proof.size > EVENT_PROOF_MAX_BYTES) {
      throw new BadRequestException('Justificatif trop volumineux');
    }

    return `data:${proof.mimetype};base64,${proof.buffer.toString('base64')}`;
  }

  private async syncEventBalances(
    client: Prisma.TransactionClient,
    user: {
      id: string;
      sexe: Prisma.UserGetPayload<{
        select: { sexe: true };
      }>['sexe'];
      dateEmbauche: Date;
      passifInitial: number;
      children: { dateNaissance: Date }[];
      events: { type: EventType; eventDate: Date; processed: boolean }[];
    },
    year: number,
  ) {
    const leaveTypes = await client.leaveType.findMany({
      where: {
        active: true,
        code: { in: ['PAT', 'MAT', 'ENF'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        defaultDays: true,
      },
    });

    await Promise.all(
      leaveTypes.map(async (leaveType) => {
        const range = getLeaveYearRange(year);
        const [requests, holidays, existingBalance] = await Promise.all([
          client.leaveRequest.findMany({
            where: {
              ownerId: user.id,
              leaveTypeId: leaveType.id,
              startDate: { lt: range.endExclusive },
              endDate: { gte: range.start },
            },
            select: {
              startDate: true,
              endDate: true,
              days: true,
              status: true,
              submittedAt: true,
            },
          }),
          client.publicHoliday.findMany({
            where: {
              country: 'CM',
              OR: [
                { recurring: true },
                { date: { gte: range.start, lt: range.endExclusive } },
              ],
            },
            select: { date: true, recurring: true },
          }),
          client.leaveBalance.findUnique({
            where: {
              userId_leaveTypeId_year: {
                userId: user.id,
                leaveTypeId: leaveType.id,
                year,
              },
            },
            select: { takenAdjustment: true },
          }),
        ]);
        const takenAdjustment = this.toNumber(
          existingBalance?.takenAdjustment ?? 0,
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
      }),
    );
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
    request: { startDate: Date; endDate: Date; days?: number },
    year: number,
    holidays: { date: Date; recurring: boolean }[],
  ) {
    const segments = splitPeriodByLeaveYear(request.startDate, request.endDate);
    const weightedSegments = segments.map((segment) => ({
      ...segment,
      workingDays: countWorkingDays(
        segment.startDate,
        segment.endDate,
        holidays,
      ),
    }));
    const segmentWorkingDays = weightedSegments
      .filter((segment) => segment.year === year)
      .reduce((total, segment) => total + segment.workingDays, 0);
    const storedDays = this.toNumber(request.days);
    const totalWorkingDays = weightedSegments.reduce(
      (total, segment) => total + segment.workingDays,
      0,
    );

    if (storedDays > 0 && totalWorkingDays > 0) {
      return this.toNumber(
        (storedDays * segmentWorkingDays) / totalWorkingDays,
      );
    }

    return this.toNumber(segmentWorkingDays);
  }

  private async resolveRh(rhId?: string, rhEmail?: string) {
    const where = rhId?.trim()
      ? { id: rhId.trim() }
      : rhEmail?.trim()
        ? { email: rhEmail.trim().toLowerCase() }
        : null;

    if (!where) {
      throw new BadRequestException('RH requise');
    }

    const rhUser = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: true } },
      },
    });

    if (!rhUser || rhUser.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur RH introuvable');
    }
    if (!rhUser.roles.some((role) => role.role === RoleType.RH)) {
      throw new BadRequestException(
        'Seul un utilisateur RH peut valider une déclaration',
      );
    }

    return rhUser;
  }

  private toResponse(
    event: Prisma.EventGetPayload<{ select: typeof eventSelect }>,
  ) {
    return {
      id: event.id,
      type: event.type,
      typeLabel: this.eventSpecificLabel(event) || this.eventLabel(event.type),
      eventDate: this.formatDate(event.eventDate),
      eventDateInput: this.toDateInput(event.eventDate),
      createdAt: this.formatDate(event.createdAt),
      description: event.description ?? '',
      proofUrl: event.proofUrl,
      hasProof: Boolean(event.proofUrl),
      processed: event.processed,
      statusCode: event.status,
      statusLabel: this.eventStatus(event.status).label,
      statusTone: this.eventStatus(event.status).tone,
      rhComment: event.rhComment ?? '',
      reviewedAt: event.reviewedAt?.toISOString() ?? null,
    };
  }

  private toUser(
    user: Awaited<ReturnType<EmployeeEventsService['resolveUser']>>,
  ) {
    return {
      id: user.id,
      email: user.email,
      name: this.fullName(user),
      matricule: user.matricule,
    };
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private formatDate(value: Date) {
    return new Intl.DateTimeFormat('fr-FR').format(value);
  }

  private toDateInput(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private buildEventTypeOptions() {
    const options = new Map<
      string,
      {
        id: string;
        value: EventType;
        label: string;
        code?: string;
        days?: number;
      }
    >();
    const add = (
      id: string,
      value: EventType,
      label: string,
      code?: string,
      days?: number,
    ) => {
      options.set(id, { id, value, label, code, days });
    };

    for (const rule of EXCEPTIONAL_PERMISSION_RULES) {
      add(
        `leave-type:${rule.code}`,
        rule.eventType,
        `${rule.name} (${rule.defaultDays} jour${rule.defaultDays > 1 ? 's' : ''})`,
        rule.code,
        rule.defaultDays,
      );
    }

    return Array.from(options.values());
  }

  private eventLabel(type: EventType) {
    const labels: Record<EventType, string> = {
      BIRTH: 'Naissance / enfant',
      MARRIAGE: 'Mariage',
      DEATH: 'Décès',
      ILLNESS: 'Maladie',
      OTHER: 'Autre événement',
    };

    return labels[type];
  }

  private eventSpecificLabel(event: {
    description: string | null;
    type: EventType;
  }) {
    const description = event.description ?? '';
    const codeMatch = description.match(/\[([A-Z0-9_]+)\]/);
    const rule = codeMatch ? findExceptionalPermissionRule(codeMatch[1]) : null;

    return rule
      ? `${rule.name} (${rule.defaultDays} jour${rule.defaultDays > 1 ? 's' : ''})`
      : null;
  }

  private eventStatus(status: LeaveRequestStatus) {
    if (status === LeaveRequestStatus.APPROVED) {
      return { tone: 'valid', label: 'Validé par la RH' } as const;
    }
    if (status === LeaveRequestStatus.REJECTED) {
      return { tone: 'rejected', label: 'Refusé par la RH' } as const;
    }
    if (status === LeaveRequestStatus.IN_REVIEW) {
      return { tone: 'pending', label: 'En revue RH' } as const;
    }

    return { tone: 'pending', label: 'En attente RH' } as const;
  }

  private toNumber(value: number | null | undefined) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
