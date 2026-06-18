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
  FindEmployeeEventsQueryDto,
  ReviewEmployeeEventDto,
} from './dto/employee-event.dto';
import { EmailService } from '../../shared/notifications/email.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { fieldDateWhere, resolveDateRange } from '../../../common/date-range';

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
  processed: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
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

      const processed = Boolean(dto.approved);
      const updated = await transaction.event.update({
        where: { id },
        data: { processed },
        select: eventSelect,
      });

      await this.syncEventBalances(
        transaction,
        event.user,
        event.eventDate.getUTCFullYear(),
      );

      await transaction.auditLog.create({
        data: {
          userId: rhUser.id,
          action: AuditAction.UPDATE,
          entity: 'Event',
          entityId: event.id,
          metadata: {
            source: 'rh',
            decision: processed ? 'approved' : 'rejected',
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
            description: processed
              ? 'Votre déclaration a été validée par la RH.'
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
      throw new BadRequestException('Le justificatif doit être une image');
    }
    if (proof.size > EVENT_PROOF_MAX_BYTES) {
      throw new BadRequestException('Image justificative trop volumineuse');
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

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));

    await Promise.all(
      leaveTypes.map(async (leaveType) => {
        const [approved, scheduled] = await Promise.all([
          client.leaveRequest.aggregate({
            where: {
              ownerId: user.id,
              leaveTypeId: leaveType.id,
              startDate: { gte: yearStart, lt: nextYearStart },
              status: LeaveRequestStatus.APPROVED,
            },
            _sum: { days: true },
          }),
          client.leaveRequest.aggregate({
            where: {
              ownerId: user.id,
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
      typeLabel: this.eventLabel(event.type),
      eventDate: this.formatDate(event.eventDate),
      eventDateInput: this.toDateInput(event.eventDate),
      createdAt: this.formatDate(event.createdAt),
      description: event.description ?? '',
      proofUrl: event.proofUrl,
      hasProof: Boolean(event.proofUrl),
      processed: event.processed,
      statusLabel: event.processed ? 'Traité RH' : 'En attente RH',
      statusTone: event.processed ? 'valid' : 'pending',
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

  private toNumber(value: number | null | undefined) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
