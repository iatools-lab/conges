import {
  BadRequestException,
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
  Sexe,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateEmployeeLeaveRequestDto,
  FindEmployeeLeaveRequestsQueryDto,
  UpdateEmployeeLeaveRequestDto,
} from './dto/employee-leave-request.dto';
import { EmailService } from '../../shared/notifications/email.service';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';
import { countWorkingDays as countBusinessDays } from '../../../common/working-days';

const employeeLeaveRequestSelect = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  leaveType: { select: { id: true, code: true, name: true, category: true } },
  validations: {
    orderBy: { decidedAt: 'desc' },
    take: 1,
    select: { decision: true, comment: true, decidedAt: true },
  },
} satisfies Prisma.LeaveRequestSelect;

type EmployeeLeaveRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof employeeLeaveRequestSelect;
}>;

const editableStatuses: LeaveRequestStatus[] = [
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
];

const cancellableStatuses: LeaveRequestStatus[] = [
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
];

type SubmissionEmail = {
  to: string;
  subject: string;
  text: string;
  link: string;
  actionLabel: string;
};

const PAID_POOL_CODE = 'PAYE';
const SPECIAL_POOL_CODE = 'SPECIAL';
const MATERNITY_CODE = 'MAT';
const MATERNITY_REQUIRED_DAYS = 90;
const SPECIAL_POOL_CAP_DAYS = 12;
const PAID_SOURCE_CODES = new Set(['CP', 'ANC', 'ENF']);
const EXCLUDED_SPECIAL_CODES = new Set(['PASSIF', 'MAT', 'SS']);

@Injectable()
export class EmployeeLeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findAll(query: FindEmployeeLeaveRequestsQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    const [requests, leaveTypes] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          ownerId: user.id,
          ...overlapDateWhere(range),
        },
        orderBy: [{ createdAt: 'desc' }, { reference: 'desc' }],
        select: employeeLeaveRequestSelect,
      }),
      this.findLeaveTypes(),
    ]);

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      user: {
        id: user.id,
        email: user.email,
        name: this.fullName(user),
        matricule: user.matricule,
        department: user.department,
      },
      leaveTypes,
      rows: requests
        .slice()
        .sort(
          (left, right) => this.requestDateMs(right) - this.requestDateMs(left),
        )
        .map((request) => this.toResponse(request)),
    };
  }

  async findHolidays() {
    const rows = await this.prisma.publicHoliday.findMany({
      where: { country: 'CM' },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, name: true, recurring: true },
    });

    return {
      rows: rows.map((holiday) => ({
        ...holiday,
        date: holiday.date.toISOString().slice(0, 10),
      })),
    };
  }

  async create(dto: CreateEmployeeLeaveRequestDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const startDate = this.parseDate(dto.startDate);
    const endDate = this.parseDate(dto.endDate);
    const days = await this.countWorkingDays(startDate, endDate);
    const isDraft = dto.draft === true;
    if (days <= 0) throw new BadRequestException('Période invalide');

    const leaveSelection = await this.resolveLeaveSelection({
      userId: user.id,
      requestedCode: dto.leaveTypeCode,
      requestedSubtypeCode: dto.leaveSubtypeCode,
      year: startDate.getUTCFullYear(),
      requestedDays: days,
    });

    await this.ensureSufficientBalance({
      userId: user.id,
      leaveTypeId: leaveSelection.leaveType.id,
      year: startDate.getUTCFullYear(),
      requestedDays: days,
      skipCheck: leaveSelection.poolCode !== null,
    });

    await this.ensureMaternityFullRequest({
      userId: user.id,
      leaveTypeId: leaveSelection.leaveType.id,
      leaveTypeCode: leaveSelection.leaveType.code,
      userSexe: user.sexe,
      year: startDate.getUTCFullYear(),
      requestedDays: days,
    });

    const { request, emails } = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.leaveRequest.create({
          data: {
            reference: this.buildReference(startDate),
            ownerId: user.id,
            leaveTypeId: leaveSelection.leaveType.id,
            startDate,
            endDate,
            days,
            reason: dto.reason?.trim() || null,
            status: isDraft
              ? LeaveRequestStatus.DRAFT
              : LeaveRequestStatus.PENDING,
            submittedAt: isDraft ? null : new Date(),
          },
          select: employeeLeaveRequestSelect,
        });

        const emails = isDraft
          ? []
          : await this.notifySubmission(transaction, {
              user,
              leaveTypeName: leaveSelection.displayName,
              days,
              reference: created.reference,
            });

        await transaction.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.CREATE,
            entity: 'LeaveRequest',
            entityId: created.id,
            metadata: {
              source: 'employee',
              reference: created.reference,
              leaveType: leaveSelection.leaveType.code,
              leavePool: leaveSelection.poolCode,
              draft: isDraft,
            },
          },
        });

        await this.leaveBalanceSync.syncForRequest(created.id, transaction);

        return { request: created, emails };
      },
    );

    await this.emailService.sendMany(emails);

    return this.toResponse(request);
  }

  async update(id: string, dto: UpdateEmployeeLeaveRequestDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.findOwnedRequest(id, user.id);
    if (!this.isEditable(existing)) {
      throw new ForbiddenException('Cette demande ne peut plus être modifiée');
    }

    const startDate = dto.startDate
      ? this.parseDate(dto.startDate)
      : existing.startDate;
    const endDate = dto.endDate
      ? this.parseDate(dto.endDate)
      : existing.endDate;
    const days = await this.countWorkingDays(startDate, endDate);
    if (days <= 0) throw new BadRequestException('Période invalide');
    const startYear = startDate.getUTCFullYear();
    const existingYear = existing.startDate.getUTCFullYear();
    const draftPoolCredit =
      this.reservesBalance(existing) && existingYear === startYear
        ? existing.days
        : 0;

    const existingPoolCode = this.poolCodeFromLeaveType(existing.leaveType);
    const shouldResolveLeaveSelection =
      Boolean(dto.leaveTypeCode) || existingPoolCode !== null;
    const leaveSelection = shouldResolveLeaveSelection
      ? await this.resolveLeaveSelection({
          userId: user.id,
          requestedCode:
            dto.leaveTypeCode ?? existingPoolCode ?? existing.leaveType.code,
          requestedSubtypeCode:
            dto.leaveSubtypeCode ??
            (existingPoolCode ? existing.leaveType.code : undefined),
          year: startYear,
          requestedDays: days,
          existingLeaveTypeId: existing.leaveTypeId,
          existingCredit: draftPoolCredit,
        })
      : null;

    const effectiveLeaveTypeId =
      leaveSelection?.leaveType.id ?? existing.leaveTypeId;
    const effectiveYear = startYear;
    const balanceCredit =
      this.reservesBalance(existing) &&
      existing.leaveTypeId === effectiveLeaveTypeId &&
      existingYear === effectiveYear
        ? existing.days
        : 0;

    await this.ensureSufficientBalance({
      userId: user.id,
      leaveTypeId: effectiveLeaveTypeId,
      year: effectiveYear,
      requestedDays: days,
      balanceCredit,
      skipCheck: leaveSelection
        ? leaveSelection.poolCode !== null
        : this.poolCodeFromLeaveType(existing.leaveType) !== null,
    });

    await this.ensureMaternityFullRequest({
      userId: user.id,
      leaveTypeId: effectiveLeaveTypeId,
      leaveTypeCode: leaveSelection?.leaveType.code ?? existing.leaveType.code,
      userSexe: user.sexe,
      year: effectiveYear,
      requestedDays: days,
      balanceCredit,
    });

    const shouldResubmit = this.isReviewRequested(existing);
    const { updated, emails } = await this.prisma.$transaction(
      async (transaction) => {
        const request = await transaction.leaveRequest.update({
          where: { id },
          data: {
            ...(leaveSelection
              ? { leaveTypeId: leaveSelection.leaveType.id }
              : {}),
            startDate,
            endDate,
            days,
            reason: dto.reason?.trim() || null,
            ...(shouldResubmit
              ? {
                  status: LeaveRequestStatus.PENDING,
                  submittedAt: new Date(),
                  decidedAt: null,
                  cancelledAt: null,
                }
              : {}),
          },
          select: employeeLeaveRequestSelect,
        });

        const emails = shouldResubmit
          ? await this.notifySubmission(transaction, {
              user,
              leaveTypeName:
                leaveSelection?.displayName ?? existing.leaveType.name,
              days,
              reference: request.reference,
            })
          : [];

        await this.leaveBalanceSync.syncForKeys(
          [
            {
              userId: user.id,
              leaveTypeId: existing.leaveTypeId,
              year: existing.startDate.getUTCFullYear(),
            },
          ],
          transaction,
        );
        await this.leaveBalanceSync.syncForRequest(request.id, transaction);

        return { updated: request, emails };
      },
    );

    await this.emailService.sendMany(emails);

    return this.toResponse(updated);
  }

  async submit(id: string, dto: UpdateEmployeeLeaveRequestDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.findOwnedRequest(id, user.id);
    if (existing.status !== LeaveRequestStatus.DRAFT) {
      throw new ForbiddenException(
        'Cette planification ne peut pas être soumise',
      );
    }

    await this.ensureSufficientBalance({
      userId: user.id,
      leaveTypeId: existing.leaveTypeId,
      year: existing.startDate.getUTCFullYear(),
      requestedDays: existing.days,
      balanceCredit: this.reservesBalance(existing) ? existing.days : 0,
      skipCheck: this.poolCodeFromLeaveType(existing.leaveType) !== null,
    });

    await this.ensureMaternityFullRequest({
      userId: user.id,
      leaveTypeId: existing.leaveTypeId,
      leaveTypeCode: existing.leaveType.code,
      userSexe: user.sexe,
      year: existing.startDate.getUTCFullYear(),
      requestedDays: existing.days,
      balanceCredit: this.reservesBalance(existing) ? existing.days : 0,
    });

    const { updated, emails } = await this.prisma.$transaction(
      async (transaction) => {
        const request = await transaction.leaveRequest.update({
          where: { id },
          data: {
            status: LeaveRequestStatus.PENDING,
            submittedAt: new Date(),
            decidedAt: null,
            cancelledAt: null,
          },
          select: employeeLeaveRequestSelect,
        });

        const emails = await this.notifySubmission(transaction, {
          user,
          leaveTypeName: this.toLeaveTypeLabel(existing.leaveType),
          days: existing.days,
          reference: request.reference,
        });

        await transaction.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.UPDATE,
            entity: 'LeaveRequest',
            entityId: request.id,
            metadata: {
              source: 'employee',
              reference: request.reference,
              action: 'submit_planned_request',
            },
          },
        });

        await this.leaveBalanceSync.syncForRequest(request.id, transaction);

        return { updated: request, emails };
      },
    );

    await this.emailService.sendMany(emails);

    return this.toResponse(updated);
  }

  async cancel(id: string, dto: UpdateEmployeeLeaveRequestDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.findOwnedRequest(id, user.id);
    if (!cancellableStatuses.includes(existing.status)) {
      throw new ForbiddenException('Cette demande ne peut plus être annulée');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: LeaveRequestStatus.CANCELLED, cancelledAt: new Date() },
      select: employeeLeaveRequestSelect,
    });

    await this.leaveBalanceSync.syncForKeys([
      {
        userId: user.id,
        leaveTypeId: existing.leaveTypeId,
        year: existing.startDate.getUTCFullYear(),
      },
    ]);

    return this.toResponse(updated);
  }

  async remove(id: string, dto: UpdateEmployeeLeaveRequestDto) {
    const user = await this.resolveUser(dto.userId, dto.userEmail);
    const existing = await this.findOwnedRequest(id, user.id);
    if (existing.status !== LeaveRequestStatus.DRAFT || existing.submittedAt) {
      throw new ForbiddenException(
        'Seule une planification non soumise peut être supprimée',
      );
    }

    await this.prisma.leaveRequest.delete({ where: { id } });
    await this.leaveBalanceSync.syncForKeys([
      {
        userId: user.id,
        leaveTypeId: existing.leaveTypeId,
        year: existing.startDate.getUTCFullYear(),
      },
    ]);

    return { id, deleted: true };
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
        n2Id: true,
        n3Id: true,
        sexe: true,
        status: true,
        department: {
          select: { id: true, code: true, name: true, managerId: true },
        },
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private async findOwnedRequest(id: string, ownerId: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        submittedAt: true,
        leaveTypeId: true,
        leaveType: { select: { code: true, name: true, category: true } },
        days: true,
        validations: {
          orderBy: { decidedAt: 'desc' },
          take: 1,
          select: { decision: true },
        },
      },
    });

    if (!request) throw new NotFoundException('Demande introuvable');

    return request;
  }

  private async resolveLeaveType(code: string) {
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { code: code.trim(), active: true },
      select: { id: true, code: true, name: true },
    });

    if (!leaveType) throw new NotFoundException('Type de congé introuvable');

    return leaveType;
  }

  private async resolveLeaveSelection(params: {
    userId: string;
    requestedCode: string;
    requestedSubtypeCode?: string;
    year: number;
    requestedDays: number;
    existingLeaveTypeId?: string;
    existingCredit?: number;
  }) {
    const normalizedCode = params.requestedCode.trim().toUpperCase();
    const normalizedSubtypeCode = params.requestedSubtypeCode
      ?.trim()
      .toUpperCase();

    if (
      normalizedCode !== PAID_POOL_CODE &&
      normalizedCode !== SPECIAL_POOL_CODE
    ) {
      const leaveType = await this.resolveLeaveType(normalizedCode);
      return {
        leaveType,
        poolCode: null as string | null,
        displayName: leaveType.name,
      };
    }

    const poolKind =
      normalizedCode === PAID_POOL_CODE ? PAID_POOL_CODE : SPECIAL_POOL_CODE;
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { active: true },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
      },
    });

    const candidates = leaveTypes.filter((leaveType) =>
      this.isTypeInPool(leaveType, poolKind),
    );
    if (!candidates.length) {
      throw new BadRequestException(
        poolKind === PAID_POOL_CODE
          ? 'Aucun type de congé payé actif disponible'
          : 'Aucun type de congé spécial actif disponible',
      );
    }

    const requestedCandidate = normalizedSubtypeCode
      ? candidates.find(
          (leaveType) =>
            leaveType.code.trim().toUpperCase() === normalizedSubtypeCode,
        )
      : null;
    if (normalizedSubtypeCode && !requestedCandidate) {
      throw new BadRequestException(
        poolKind === PAID_POOL_CODE
          ? 'Ce sous-type ne fait pas partie des congés payés.'
          : 'Ce sous-type ne fait pas partie des congés spéciaux.',
      );
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        userId: params.userId,
        year: params.year,
        leaveTypeId: { in: candidates.map((item) => item.id) },
      },
      select: {
        leaveTypeId: true,
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
      },
    });
    const balanceByTypeId = new Map(
      balances.map((balance) => [
        balance.leaveTypeId,
        this.roundDays(
          balance.acquired +
            balance.carryover -
            balance.taken -
            balance.scheduled +
            (params.existingLeaveTypeId === balance.leaveTypeId
              ? (params.existingCredit ?? 0)
              : 0),
        ),
      ]),
    );

    const pooledRemainingRaw = candidates.reduce(
      (sum, leaveType) =>
        sum + Math.max(balanceByTypeId.get(leaveType.id) ?? 0, 0),
      0,
    );
    const pooledRemaining = this.roundDays(
      poolKind === SPECIAL_POOL_CODE
        ? Math.min(SPECIAL_POOL_CAP_DAYS, pooledRemainingRaw)
        : pooledRemainingRaw,
    );

    if (params.requestedDays > pooledRemaining) {
      throw new BadRequestException(
        poolKind === SPECIAL_POOL_CODE
          ? `Le nombre de jours demandé (${this.roundDays(params.requestedDays)}) excède le plafond disponible de congés spéciaux (${pooledRemaining}).`
          : `Le nombre de jours demandé (${this.roundDays(params.requestedDays)}) excède votre total de congés payés disponible (${pooledRemaining}).`,
      );
    }

    const existingCandidate = params.existingLeaveTypeId
      ? candidates.find(
          (leaveType) => leaveType.id === params.existingLeaveTypeId,
        )
      : null;
    const existingCandidateRemaining = existingCandidate
      ? (balanceByTypeId.get(existingCandidate.id) ?? 0)
      : 0;

    const preferredCodes =
      poolKind === PAID_POOL_CODE
        ? ['CP', 'ANC', 'ENF']
        : ['SPE', 'PAT', 'MAL'];

    const rankedCandidates = [...candidates].sort((left, right) => {
      const leftIndex = preferredCodes.indexOf(left.code);
      const rightIndex = preferredCodes.indexOf(right.code);
      const leftOrder = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
      const rightOrder =
        rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      const rightRemaining = balanceByTypeId.get(right.id) ?? 0;
      const leftRemaining = balanceByTypeId.get(left.id) ?? 0;
      if (rightRemaining !== leftRemaining) {
        return rightRemaining - leftRemaining;
      }

      return left.code.localeCompare(right.code);
    });

    const selected =
      requestedCandidate ??
      (existingCandidate && existingCandidateRemaining >= params.requestedDays
        ? existingCandidate
        : null) ??
      rankedCandidates.find(
        (leaveType) =>
          (balanceByTypeId.get(leaveType.id) ?? 0) >= params.requestedDays,
      ) ??
      rankedCandidates[0];

    return {
      leaveType: {
        id: selected.id,
        code: selected.code,
        name: selected.name,
      },
      poolCode: poolKind,
      displayName:
        poolKind === PAID_POOL_CODE
          ? 'Congés payés (total annuel)'
          : 'Congés spéciaux (plafond 12 jours)',
    };
  }

  private async ensureSufficientBalance(params: {
    userId: string;
    leaveTypeId: string;
    year: number;
    requestedDays: number;
    balanceCredit?: number;
    skipCheck?: boolean;
  }) {
    if (params.skipCheck) return;

    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId: params.userId,
          leaveTypeId: params.leaveTypeId,
          year: params.year,
        },
      },
      select: {
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
      },
    });

    // Some leave types are not balance-driven; skip the quota check if no balance exists.
    if (!balance) return;

    const credit = params.balanceCredit ?? 0;
    const remaining = this.roundDays(
      balance.acquired +
        balance.carryover -
        balance.taken -
        balance.scheduled +
        credit,
    );

    if (params.requestedDays > remaining) {
      throw new BadRequestException(
        `Le nombre de jours demandé (${this.roundDays(params.requestedDays)}) excède votre solde disponible (${remaining}).`,
      );
    }
  }

  private async findLeaveTypes() {
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        requiresProof: true,
      },
    });

    const paidChildren = leaveTypes.filter((leaveType) =>
      this.isTypeInPool(leaveType, PAID_POOL_CODE),
    );
    const specialChildren = leaveTypes.filter((leaveType) =>
      this.isTypeInPool(leaveType, SPECIAL_POOL_CODE),
    );
    const maternity = leaveTypes.find(
      (leaveType) => leaveType.code.trim().toUpperCase() === MATERNITY_CODE,
    );

    const options: Array<{
      id: string;
      code: string;
      name: string;
      category: LeaveCategory;
      requiresProof: boolean;
      children?: Array<{
        id: string;
        code: string;
        name: string;
        category: LeaveCategory;
        requiresProof: boolean;
      }>;
    }> = [];

    if (paidChildren.length) {
      options.push({
        id: PAID_POOL_CODE,
        code: PAID_POOL_CODE,
        name: 'Congés payés (total annuel)',
        category: LeaveCategory.CONGE_PAYE,
        requiresProof: paidChildren.some(
          (leaveType) => leaveType.requiresProof,
        ),
        children: paidChildren,
      });
    }

    if (specialChildren.length) {
      options.push({
        id: SPECIAL_POOL_CODE,
        code: SPECIAL_POOL_CODE,
        name: 'Congés spéciaux (plafond 12 jours)',
        category: LeaveCategory.CONGE_SPECIAL,
        requiresProof: specialChildren.some(
          (leaveType) => leaveType.requiresProof,
        ),
        children: specialChildren,
      });
    }

    options.push(
      maternity ?? {
        id: MATERNITY_CODE,
        code: MATERNITY_CODE,
        name: 'Congés maternité',
        category: LeaveCategory.CONGE_MATERNITE,
        requiresProof: true,
      },
    );

    return options;
  }

  private async ensureMaternityFullRequest(params: {
    userId: string;
    leaveTypeId: string;
    leaveTypeCode: string;
    userSexe: Sexe;
    year: number;
    requestedDays: number;
    balanceCredit?: number;
  }) {
    if (params.leaveTypeCode.trim().toUpperCase() !== MATERNITY_CODE) return;

    if (params.userSexe !== Sexe.F) {
      throw new BadRequestException(
        'Le congé maternité est réservé aux employées.',
      );
    }

    if (params.requestedDays !== MATERNITY_REQUIRED_DAYS) {
      throw new BadRequestException(
        `Le congé maternité doit être pris en totalité (${MATERNITY_REQUIRED_DAYS} jours).`,
      );
    }

    const balance = await this.prisma.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId: params.userId,
          leaveTypeId: params.leaveTypeId,
          year: params.year,
        },
      },
      select: {
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
      },
    });

    if (!balance) {
      throw new BadRequestException(
        'Aucun solde de congé maternité disponible pour cette année.',
      );
    }

    const credit = params.balanceCredit ?? 0;
    const remaining = this.roundDays(
      balance.acquired +
        balance.carryover -
        balance.taken -
        balance.scheduled +
        credit,
    );

    if (remaining < MATERNITY_REQUIRED_DAYS) {
      throw new BadRequestException(
        `Le congé maternité doit être pris en totalité (${MATERNITY_REQUIRED_DAYS} jours) et votre solde disponible est insuffisant (${remaining}).`,
      );
    }
  }

  private toResponse(request: EmployeeLeaveRequest) {
    const lastValidation = request.validations[0];
    const status = this.toStatus(request.status, lastValidation?.decision);
    const reviewComment =
      lastValidation?.decision === ValidationDecision.REVIEW_REQUESTED
        ? lastValidation.comment?.trim() || ''
        : '';

    return {
      id: request.id,
      reference: request.reference,
      date: this.formatDate(request.submittedAt ?? request.createdAt),
      type: this.toLeaveTypeLabel(request.leaveType),
      leaveTypeCode: this.toLeaveTypeCodeForSelection(request.leaveType),
      category: this.toLeaveTypeCategoryForSelection(request.leaveType),
      periode: `${this.formatDate(request.startDate)} → ${this.formatDate(request.endDate)}`,
      startDate: this.toInputDate(request.startDate),
      endDate: this.toInputDate(request.endDate),
      jours: this.roundDays(request.days),
      status: status.tone,
      stext: status.label,
      last: reviewComment || status.last,
      reviewComment,
      reason: request.reason ?? '',
      canEdit: this.isEditable(request),
      canCancel: cancellableStatuses.includes(request.status),
      leaveSubtypeCode: this.toLeaveSubtypeCodeForSelection(request.leaveType),
    };
  }

  private requestDateMs(request: {
    submittedAt: Date | null;
    createdAt: Date;
  }) {
    return (request.submittedAt ?? request.createdAt).getTime();
  }

  private toStatus(
    status: LeaveRequestStatus,
    lastDecision?: ValidationDecision,
  ) {
    if (
      status === LeaveRequestStatus.DRAFT &&
      lastDecision === ValidationDecision.REVIEW_REQUESTED
    ) {
      return {
        tone: 'review' as const,
        label: 'En revue',
        last: 'Modifications demandées',
      };
    }

    const map: Record<
      LeaveRequestStatus,
      {
        tone:
          | 'valid'
          | 'pending'
          | 'rejected'
          | 'draft'
          | 'neutral'
          | 'planned'
          | 'review';
        label: string;
        last: string;
      }
    > = {
      [LeaveRequestStatus.DRAFT]: {
        tone: 'planned',
        label: 'Planifié',
        last: 'Planification non soumise',
      },
      [LeaveRequestStatus.PENDING]: {
        tone: 'pending',
        label: 'En attente',
        last: 'Soumis au manager',
      },
      [LeaveRequestStatus.IN_REVIEW]: {
        tone: 'review',
        label: 'En revue RH',
        last: 'En attente RH',
      },
      [LeaveRequestStatus.APPROVED]: {
        tone: 'valid',
        label: 'Confirmé RH',
        last: 'Validé',
      },
      [LeaveRequestStatus.REJECTED]: {
        tone: 'rejected',
        label: 'Refusé',
        last: 'Demande refusée',
      },
      [LeaveRequestStatus.CANCELLED]: {
        tone: 'neutral',
        label: 'Annulé',
        last: 'Annulé par le demandeur',
      },
    };

    return map[status];
  }

  private parseDate(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()))
      throw new BadRequestException('Date invalide');

    return date;
  }

  private async countWorkingDays(start: Date, end: Date) {
    if (start > end) return 0;

    const holidays = await this.prisma.publicHoliday.findMany({
      where: {
        country: 'CM',
        OR: [{ date: { gte: start, lte: end } }, { recurring: true }],
      },
      select: { date: true, recurring: true },
    });

    return countBusinessDays(start, end, holidays);
  }

  private buildReference(startDate: Date) {
    const year = startDate.getUTCFullYear();
    return `DM-${year}-${Date.now().toString(36).toUpperCase()}`;
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  private toInputDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private isReviewRequested(request: {
    status: LeaveRequestStatus;
    validations: { decision: ValidationDecision }[];
  }) {
    return (
      (request.status === LeaveRequestStatus.DRAFT ||
        request.status === LeaveRequestStatus.IN_REVIEW) &&
      request.validations[0]?.decision === ValidationDecision.REVIEW_REQUESTED
    );
  }

  private isEditable(request: {
    status: LeaveRequestStatus;
    validations: { decision: ValidationDecision }[];
  }) {
    return (
      editableStatuses.includes(request.status) ||
      this.isReviewRequested(request)
    );
  }

  private reservesBalance(request: {
    status: LeaveRequestStatus;
    submittedAt: Date | null;
  }) {
    return (
      request.status === LeaveRequestStatus.PENDING ||
      request.status === LeaveRequestStatus.IN_REVIEW ||
      (request.status === LeaveRequestStatus.DRAFT && !request.submittedAt)
    );
  }

  private async notifySubmission(
    transaction: Prisma.TransactionClient,
    params: {
      user: Awaited<ReturnType<EmployeeLeaveRequestsService['resolveUser']>>;
      leaveTypeName: string;
      days: number;
      reference: string;
    },
  ): Promise<SubmissionEmail[]> {
    const approverId = params.user.n1Id || null;
    const watcherIds = [params.user.n2Id, params.user.n3Id].filter(
      (recipientId): recipientId is string => Boolean(recipientId),
    );
    const recipients = Array.from(
      new Set([...(approverId ? [approverId] : []), ...watcherIds]),
    ).filter((recipientId) => recipientId !== params.user.id);

    if (recipients.length === 0) return [];

    await transaction.notification.createMany({
      data: recipients.map((recipientId) => ({
        userId: recipientId,
        type: NotificationType.REQUEST_SUBMITTED,
        title:
          recipientId === approverId
            ? 'Nouvelle demande à valider'
            : 'Nouvelle demande à consulter',
        description:
          recipientId === approverId
            ? `${this.fullName(params.user)} — ${params.leaveTypeName} (${this.roundDays(params.days)} j)`
            : `${this.fullName(params.user)} — ${params.leaveTypeName} (${this.roundDays(params.days)} j) · information N+`,
        link: '/manager/demandes',
      })),
    });

    const recipientUsers = await transaction.user.findMany({
      where: {
        id: { in: recipients },
        status: { not: UserStatus.INACTIVE },
      },
      select: {
        id: true,
        email: true,
      },
    });

    return recipientUsers
      .filter((recipient) => Boolean(recipient.email))
      .map((recipient) => ({
        to: recipient.email,
        subject:
          recipient.id === approverId
            ? 'Nouvelle demande de conge a valider'
            : 'Nouvelle demande de conge a consulter',
        text:
          recipient.id === approverId
            ? `${this.fullName(params.user)} a soumis ${params.leaveTypeName} (${this.roundDays(params.days)} jour(s)). Reference: ${params.reference}.`
            : `${this.fullName(params.user)} a soumis ${params.leaveTypeName} (${this.roundDays(params.days)} jour(s)). Vous etes en copie de suivi. Reference: ${params.reference}.`,
        link: '/manager/demandes',
        actionLabel: 'Voir la demande',
      }));
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }

  private isTypeInPool(
    leaveType: { code: string; category: LeaveCategory },
    poolCode: typeof PAID_POOL_CODE | typeof SPECIAL_POOL_CODE,
  ) {
    const normalizedCode = leaveType.code.trim().toUpperCase();

    if (poolCode === PAID_POOL_CODE) {
      return PAID_SOURCE_CODES.has(normalizedCode);
    }

    return (
      !PAID_SOURCE_CODES.has(normalizedCode) &&
      !EXCLUDED_SPECIAL_CODES.has(normalizedCode) &&
      (leaveType.category === LeaveCategory.CONGE_SPECIAL ||
        leaveType.category === LeaveCategory.CONGE_PATERNITE ||
        leaveType.category === LeaveCategory.CONGE_MALADIE)
    );
  }

  private poolCodeFromLeaveType(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    if (this.isTypeInPool(leaveType, PAID_POOL_CODE)) return PAID_POOL_CODE;
    if (this.isTypeInPool(leaveType, SPECIAL_POOL_CODE)) {
      return SPECIAL_POOL_CODE;
    }

    return null;
  }

  private toLeaveTypeLabel(leaveType: {
    code: string;
    name: string;
    category: LeaveCategory;
  }) {
    if (this.isTypeInPool(leaveType, PAID_POOL_CODE)) {
      return 'Congés payés (total annuel)';
    }
    if (this.isTypeInPool(leaveType, SPECIAL_POOL_CODE)) {
      return 'Congés spéciaux (plafond 12 jours)';
    }

    return leaveType.name;
  }

  private toLeaveTypeCodeForSelection(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    if (this.isTypeInPool(leaveType, PAID_POOL_CODE)) return PAID_POOL_CODE;
    if (this.isTypeInPool(leaveType, SPECIAL_POOL_CODE))
      return SPECIAL_POOL_CODE;

    return leaveType.code;
  }

  private toLeaveSubtypeCodeForSelection(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    if (
      this.isTypeInPool(leaveType, PAID_POOL_CODE) ||
      this.isTypeInPool(leaveType, SPECIAL_POOL_CODE)
    ) {
      return leaveType.code;
    }

    return undefined;
  }

  private toLeaveTypeCategoryForSelection(leaveType: {
    category: LeaveCategory;
    code: string;
  }) {
    if (this.isTypeInPool(leaveType, PAID_POOL_CODE)) {
      return LeaveCategory.CONGE_PAYE;
    }
    if (this.isTypeInPool(leaveType, SPECIAL_POOL_CODE)) {
      return LeaveCategory.CONGE_SPECIAL;
    }

    return leaveType.category;
  }
}
