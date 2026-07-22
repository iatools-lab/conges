import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  LeaveCategory,
  LeaveRequestStatus,
  NotificationType,
  Prisma,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DecideManagerRequestDto,
  FindManagerRequestsQueryDto,
  ManagerRequestDecision,
} from './dto/manager-request.dto';
import { EmailService } from '../../shared/notifications/email.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';
import {
  getLeaveYear,
  getLeaveYearsForPeriod,
} from '../../../common/leave-year';
import {
  isPaidLeavePool,
  isSpecialLeavePool,
  summarizePaidLeavePool,
  summarizeSpecialLeavePool,
} from '../../shared/leave-balances/leave-balance-pools';

type BadgeTone =
  | 'valid'
  | 'pending'
  | 'rejected'
  | 'draft'
  | 'neutral'
  | 'review';

const managerRequestSelect = {
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
  leaveTypeId: true,
  owner: {
    select: {
      id: true,
      matricule: true,
      email: true,
      nom: true,
      prenom: true,
      poste: true,
      n1Id: true,
      n2Id: true,
      n3Id: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
  leaveType: {
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type ManagerRequestRecord = Prisma.LeaveRequestGetPayload<{
  select: typeof managerRequestSelect;
}>;

type ManagerRequestBalance = {
  userId: string;
  leaveTypeId: string;
  year: number;
  acquired: number;
  carryover: number;
  taken: number;
  scheduled: number;
  leaveType: { code: string; category: LeaveCategory };
};

@Injectable()
export class ManagerRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findAll(query: FindManagerRequestsQueryDto) {
    const manager = await this.resolveManager(
      query.managerId,
      query.managerEmail,
    );
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    const visibleOwnerWhere = this.buildVisibleOwnerWhere(manager);

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        ...overlapDateWhere(range),
        owner: visibleOwnerWhere,
        OR: [
          { status: { not: LeaveRequestStatus.DRAFT } },
          { submittedAt: { not: null } },
        ],
      },
      orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
      select: managerRequestSelect,
    });

    await this.syncVisibleRequestBalances(requests);
    const balanceByKey = await this.findBalances(requests, year);
    const rows = requests.map((request) =>
      this.toResponse(
        request,
        balanceByKey.get(this.balanceKey(request)),
        this.canDecideRequest(manager, request),
      ),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      manager: {
        id: manager.id,
        name: this.fullName(manager),
        department: manager.department,
        managedDepartments: this.getManagedDepartments(manager),
      },
      rows,
      totals: this.buildTotals(rows),
    };
  }

  async decide(id: string, dto: DecideManagerRequestDto) {
    const manager = await this.resolveManager(dto.managerId, dto.managerEmail);
    const comment = dto.comment?.trim();

    if ((dto.decision === 'reject' || dto.decision === 'review') && !comment) {
      throw new BadRequestException(
        'Un motif est obligatoire pour refuser une demande ou demander une revue.',
      );
    }

    const existing = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: managerRequestSelect,
    });

    if (!existing) throw new NotFoundException('Demande introuvable');
    if (!this.canDecideRequest(manager, existing)) {
      throw new ForbiddenException('Demande hors périmètre manager');
    }
    const now = new Date();
    const transition = this.getTransition(dto.decision);

    if (existing.status !== LeaveRequestStatus.PENDING) {
      const previousDecision = await this.prisma.validation.findFirst({
        where: {
          requestId: existing.id,
          validatorId: manager.id,
          level: 1,
          decision: transition.validationDecision,
          ...(existing.submittedAt
            ? { decidedAt: { gte: existing.submittedAt } }
            : {}),
        },
        orderBy: { decidedAt: 'desc' },
      });
      if (previousDecision) {
        const balanceByKey = await this.findBalances(
          [existing],
          getLeaveYear(existing.startDate),
        );
        return this.toResponse(
          existing,
          balanceByKey.get(this.balanceKey(existing)),
        );
      }
      throw new BadRequestException(
        'Cette demande doit être soumise avant décision',
      );
    }

    const { updated, rhEmails, applied } = await this.prisma.$transaction(
      async (transaction) => {
        const claimed = await transaction.leaveRequest.updateMany({
          where: { id: existing.id, status: LeaveRequestStatus.PENDING },
          data: {
            status: transition.status,
            decidedAt: transition.final ? now : null,
            cancelledAt: null,
          },
        });

        if (claimed.count === 0) {
          const [current, previousDecision] = await Promise.all([
            transaction.leaveRequest.findUnique({
              where: { id: existing.id },
              select: managerRequestSelect,
            }),
            transaction.validation.findFirst({
              where: {
                requestId: existing.id,
                validatorId: manager.id,
                level: 1,
                decision: transition.validationDecision,
                ...(existing.submittedAt
                  ? { decidedAt: { gte: existing.submittedAt } }
                  : {}),
              },
              orderBy: { decidedAt: 'desc' },
            }),
          ]);

          if (current && previousDecision) {
            return {
              updated: current,
              rhEmails: [] as string[],
              applied: false,
            };
          }

          throw new ConflictException(
            'Cette demande a déjà été traitée par un autre processus',
          );
        }

        await transaction.validation.create({
          data: {
            requestId: existing.id,
            validatorId: manager.id,
            level: 1,
            decision: transition.validationDecision,
            comment: comment || null,
            decidedAt: now,
          },
        });

        const request = await transaction.leaveRequest.findUniqueOrThrow({
          where: { id: existing.id },
          select: managerRequestSelect,
        });

        await this.leaveBalanceSync.syncForRequest(existing.id, transaction);

        await transaction.auditLog.create({
          data: {
            userId: manager.id,
            action: transition.auditAction,
            entity: 'LeaveRequest',
            entityId: existing.id,
            metadata: {
              source: 'manager',
              decision: dto.decision,
              reference: existing.reference,
              managerName: this.fullName(manager),
              managerEmail: manager.email,
              comment: comment || null,
            },
          },
        });

        let rhEmails: string[] = [];
        if (transition.status === LeaveRequestStatus.IN_REVIEW) {
          const rhUsers = await transaction.user.findMany({
            where: {
              status: { not: UserStatus.INACTIVE },
              roles: { some: { role: RoleType.RH } },
            },
            select: { id: true, email: true },
          });

          if (rhUsers.length > 0) {
            await transaction.notification.createMany({
              data: rhUsers.map((rhUser) => ({
                userId: rhUser.id,
                type: NotificationType.REQUEST_REVIEW,
                title: 'Demande a confirmer RH',
                description: `${existing.reference} — ${this.fullName(existing.owner)}`,
                link: '/rh/demandes-conges',
              })),
            });
          }

          rhEmails = rhUsers
            .map((rhUser) => rhUser.email?.trim().toLowerCase())
            .filter((email): email is string => Boolean(email));
        }

        return { updated: request, rhEmails, applied: true };
      },
    );

    const balanceByKey = await this.findBalances(
      [updated],
      getLeaveYear(updated.startDate),
    );

    if (applied && existing.owner.email) {
      await this.emailService.send({
        to: existing.owner.email,
        subject: this.toEmailSubject(transition.status),
        text: `Votre demande ${existing.reference} a ete traitee par votre manager. Nouveau statut: ${this.toStatus(transition.status).label}.${comment ? ` Motif: ${comment}.` : ''}`,
        link: '/demandes',
        actionLabel: 'Consulter ma demande',
      });
    }

    if (
      applied &&
      transition.status === LeaveRequestStatus.IN_REVIEW &&
      rhEmails.length > 0
    ) {
      await this.emailService.sendMany(
        rhEmails.map((email) => ({
          to: email,
          subject: 'Demande a confirmer RH',
          text: `La demande ${existing.reference} de ${this.fullName(existing.owner)} est en attente de decision RH.`,
          link: '/rh/demandes-conges',
          actionLabel: 'Traiter la demande',
        })),
      );
    }

    return this.toResponse(updated, balanceByKey.get(this.balanceKey(updated)));
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

  private buildVisibleOwnerWhere(
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

  private canDecideRequest(
    manager: Awaited<ReturnType<typeof this.resolveManager>>,
    request: ManagerRequestRecord,
  ) {
    if (request.ownerId === manager.id) return false;
    return request.owner.n1Id === manager.id;
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

  private async findBalances(requests: ManagerRequestRecord[], year: number) {
    const pairs = Array.from(
      new Map(
        requests.map((request) => {
          const requestYear = getLeaveYear(request.startDate) || year;
          return [
            `${request.ownerId}:${requestYear}`,
            {
              userId: request.ownerId,
              year: requestYear,
            },
          ];
        }),
      ).values(),
    );
    if (pairs.length === 0) return new Map<string, { remaining: number }>();

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        OR: pairs,
      },
      select: {
        userId: true,
        leaveTypeId: true,
        year: true,
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
        leaveType: {
          select: {
            code: true,
            category: true,
          },
        },
      },
    });

    const balancesByUserYear = new Map<string, typeof balances>();
    for (const balance of balances) {
      const key = `${balance.userId}:${balance.year}`;
      const list = balancesByUserYear.get(key) ?? [];
      list.push(balance);
      balancesByUserYear.set(key, list);
    }

    return new Map(
      requests.map((request) => {
        const requestYear = getLeaveYear(request.startDate) || year;
        const requestBalances =
          balancesByUserYear.get(`${request.ownerId}:${requestYear}`) ?? [];

        return [
          this.balanceKey(request),
          {
            remaining: this.balanceRemainingForRequest(
              request,
              requestBalances,
            ),
          },
        ];
      }),
    );
  }

  private async syncVisibleRequestBalances(requests: ManagerRequestRecord[]) {
    await this.leaveBalanceSync.syncForKeys(
      requests.flatMap((request) =>
        getLeaveYearsForPeriod(request.startDate, request.endDate).map(
          (year) => ({
            userId: request.ownerId,
            leaveTypeId: request.leaveTypeId,
            year,
          }),
        ),
      ),
    );
  }

  private balanceRemainingForRequest(
    request: ManagerRequestRecord,
    balances: ManagerRequestBalance[],
  ) {
    if (isPaidLeavePool(request)) {
      return summarizePaidLeavePool(balances).remaining;
    }

    if (isSpecialLeavePool(request)) {
      return summarizeSpecialLeavePool(balances).remaining;
    }

    const balance = balances.find(
      (candidate) => candidate.leaveTypeId === request.leaveTypeId,
    );

    if (!balance) return 0;

    return this.roundDays(
      balance.acquired + balance.carryover - balance.taken - balance.scheduled,
    );
  }

  private getTransition(decision: ManagerRequestDecision) {
    const transitions: Record<
      ManagerRequestDecision,
      {
        status: LeaveRequestStatus;
        validationDecision: ValidationDecision;
        auditAction: AuditAction;
        final: boolean;
      }
    > = {
      approve: {
        status: LeaveRequestStatus.IN_REVIEW,
        validationDecision: ValidationDecision.APPROVED,
        auditAction: AuditAction.APPROVE,
        final: false,
      },
      reject: {
        status: LeaveRequestStatus.REJECTED,
        validationDecision: ValidationDecision.REJECTED,
        auditAction: AuditAction.REJECT,
        final: true,
      },
      review: {
        status: LeaveRequestStatus.DRAFT,
        validationDecision: ValidationDecision.REVIEW_REQUESTED,
        auditAction: AuditAction.UPDATE,
        final: false,
      },
    };

    return transitions[decision];
  }

  private toResponse(
    request: ManagerRequestRecord,
    balance?: { remaining: number },
    canDecide = false,
  ) {
    const status = this.toStatus(request.status);
    return {
      id: request.id,
      reference: request.reference,
      emp: this.fullName(request.owner),
      employeeName: this.fullName(request.owner),
      matricule: request.owner.matricule,
      poste: request.owner.poste,
      dept: request.owner.department?.code ?? 'N/A',
      departmentName: request.owner.department?.name ?? 'Non affecté',
      type: request.leaveType.name,
      typeCode: request.leaveType.code,
      debut: this.formatDate(request.startDate),
      fin: this.formatDate(request.endDate),
      startDate: request.startDate.toISOString(),
      endDate: request.endDate.toISOString(),
      jours: this.roundDays(request.days),
      solde: balance?.remaining ?? 0,
      status: status.key,
      statusCode: request.status,
      statusLabel: status.label,
      canDecide,
      motif: request.reason ?? 'Non renseigné',
      envoyee: request.submittedAt
        ? this.formatDate(request.submittedAt)
        : this.formatDate(request.startDate),
      submittedAt: request.submittedAt?.toISOString() ?? null,
    };
  }

  private buildTotals(rows: Array<{ status: string }>) {
    return {
      total: rows.length,
      pending: rows.filter((row) => row.status === 'pending').length,
      revision: rows.filter((row) => row.status === 'revision').length,
      valid: rows.filter((row) => row.status === 'valid').length,
      rejected: rows.filter((row) => row.status === 'rejected').length,
    };
  }

  private toStatus(status: LeaveRequestStatus): {
    key: 'pending' | 'revision' | 'valid' | 'rejected';
    tone: BadgeTone;
    label: string;
  } {
    const statusMap: Record<
      LeaveRequestStatus,
      {
        key: 'pending' | 'revision' | 'valid' | 'rejected';
        tone: BadgeTone;
        label: string;
      }
    > = {
      [LeaveRequestStatus.DRAFT]: {
        key: 'revision',
        tone: 'review',
        label: 'En revue',
      },
      [LeaveRequestStatus.PENDING]: {
        key: 'pending',
        tone: 'pending',
        label: 'En attente manager',
      },
      [LeaveRequestStatus.IN_REVIEW]: {
        key: 'revision',
        tone: 'review',
        label: 'En attente validation RH',
      },
      [LeaveRequestStatus.APPROVED]: {
        key: 'valid',
        tone: 'valid',
        label: 'Confirmée RH',
      },
      [LeaveRequestStatus.REJECTED]: {
        key: 'rejected',
        tone: 'rejected',
        label: 'Refusée',
      },
      [LeaveRequestStatus.CANCELLED]: {
        key: 'rejected',
        tone: 'neutral',
        label: 'Annulée',
      },
    };

    return statusMap[status];
  }

  private balanceKey(request: ManagerRequestRecord) {
    return `${request.ownerId}:${request.leaveTypeId}:${getLeaveYear(request.startDate)}`;
  }

  private toEmailSubject(status: LeaveRequestStatus) {
    if (status === LeaveRequestStatus.IN_REVIEW) {
      return 'Demande validee par votre manager';
    }
    if (status === LeaveRequestStatus.REJECTED) {
      return 'Demande refusee par votre manager';
    }

    return 'Demande retournee pour correction';
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
