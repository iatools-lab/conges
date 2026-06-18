import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindEmployeePlanningQueryDto } from './dto/employee-planning.dto';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

const planningRequestSelect = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  status: true,
  submittedAt: true,
  reason: true,
  leaveType: { select: { code: true, name: true, category: true } },
  validations: {
    orderBy: { decidedAt: 'desc' },
    take: 1,
    select: { decision: true },
  },
} satisfies Prisma.LeaveRequestSelect;

const departmentPlanningRequestSelect = {
  ...planningRequestSelect,
  owner: {
    select: {
      id: true,
      nom: true,
      prenom: true,
      poste: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type PlanningRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof planningRequestSelect;
}>;

type DepartmentPlanningRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof departmentPlanningRequestSelect;
}>;

const POOL_PAYE_CODE = 'PAYE';
const POOL_SPECIAL_CODE = 'SPECIAL';
const MATERNITY_CODE = 'MAT';
const PAID_SOURCE_CODES = new Set(['CP', 'ANC', 'ENF']);
const EXCLUDED_SPECIAL_CODES = new Set(['PASSIF', 'MAT', 'SS']);
const POOL_PAYE_LABEL = 'Congés payés (total annuel)';
const POOL_SPECIAL_LABEL = 'Congés spéciaux (plafond 12 j)';

@Injectable()
export class EmployeePlanningService {
  constructor(private readonly prisma: PrismaService) {}

  async findYear(query: FindEmployeePlanningQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    const [requests, leaveTypes] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          ownerId: user.id,
          status: { not: LeaveRequestStatus.CANCELLED },
          ...overlapDateWhere(range),
        },
        orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
        select: planningRequestSelect,
      }),
      this.findLeaveTypes(),
    ]);

    const plans = requests.map((request) => this.toPlan(request));

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      user: {
        id: user.id,
        email: user.email,
        name: this.fullName(user),
        matricule: user.matricule,
        department: user.department
          ? {
              id: user.department.id,
              code: user.department.code,
              name: user.department.name,
              manager: user.department.manager
                ? this.fullName(user.department.manager)
                : null,
            }
          : null,
      },
      leaveTypes,
      stats: {
        totalPlanifie: this.roundDays(
          plans.reduce((sum, plan) => sum + plan.jours, 0),
        ),
        draft: plans.filter((plan) => plan.status === 'planned').length,
        pending: plans.filter((plan) => plan.status === 'pending').length,
        valid: plans.filter((plan) => plan.status === 'valid').length,
        rejected: plans.filter((plan) => plan.status === 'rejected').length,
      },
      plans,
    };
  }

  async findDepartmentYear(query: FindEmployeePlanningQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    if (!user.department) {
      return {
        year,
        dateFrom: range.dateFromIso,
        dateTo: range.dateToIso,
        user: {
          id: user.id,
          email: user.email,
          name: this.fullName(user),
          matricule: user.matricule,
          department: null,
        },
        department: null,
        plans: [],
      };
    }

    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        owner: {
          departmentId: user.department.id,
          status: { not: UserStatus.INACTIVE },
        },
        status: {
          in: [
            LeaveRequestStatus.DRAFT,
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.IN_REVIEW,
            LeaveRequestStatus.APPROVED,
          ],
        },
        ...overlapDateWhere(range),
      },
      orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
      select: departmentPlanningRequestSelect,
    });

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
      department: user.department,
      plans: requests.map((request) => this.toDepartmentPlan(request)),
    };
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
        department: {
          select: {
            id: true,
            code: true,
            name: true,
            manager: { select: { id: true, nom: true, prenom: true } },
          },
        },
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private toPlan(request: PlanningRequest) {
    const lastDecision = request.validations[0]?.decision;
    const status = this.toStatus(request.status, lastDecision);
    const isPlannedDraft =
      request.status === LeaveRequestStatus.DRAFT &&
      lastDecision !== ValidationDecision.REVIEW_REQUESTED;

    const poolCode = this.poolCodeFromLeaveType(request.leaveType);
    const typeCode = poolCode ?? request.leaveType.code;
    const typeLabel =
      poolCode === POOL_PAYE_CODE
        ? POOL_PAYE_LABEL
        : poolCode === POOL_SPECIAL_CODE
          ? POOL_SPECIAL_LABEL
          : request.leaveType.name;
    const category =
      poolCode === POOL_PAYE_CODE
        ? LeaveCategory.CONGE_PAYE
        : poolCode === POOL_SPECIAL_CODE
          ? LeaveCategory.CONGE_SPECIAL
          : request.leaveType.category;

    return {
      id: request.id,
      reference: request.reference,
      debut: this.formatDate(request.startDate),
      fin: this.formatDate(request.endDate),
      startDate: this.toInputDate(request.startDate),
      endDate: this.toInputDate(request.endDate),
      jours: this.roundDays(request.days),
      type: typeCode,
      leaveTypeCode: typeCode,
      leaveSubtypeCode: poolCode ? request.leaveType.code : undefined,
      typeLabel,
      category,
      statusCode: request.status,
      status: status.tone,
      label: status.label,
      remplacant: '—',
      reason: request.reason ?? '',
      canSubmit: isPlannedDraft,
      canCancel: isPlannedDraft,
      canDelete: isPlannedDraft,
    };
  }

  private toDepartmentPlan(request: DepartmentPlanningRequest) {
    return {
      ...this.toPlan(request),
      employee: {
        id: request.owner.id,
        name: this.fullName(request.owner),
        poste: request.owner.poste,
        department: request.owner.department,
      },
    };
  }

  private toStatus(
    status: LeaveRequestStatus,
    lastDecision?: ValidationDecision,
  ) {
    if (
      status === LeaveRequestStatus.DRAFT &&
      lastDecision === ValidationDecision.REVIEW_REQUESTED
    ) {
      return { tone: 'review' as const, label: 'En revue' };
    }

    const map: Record<
      LeaveRequestStatus,
      {
        tone:
          | 'draft'
          | 'pending'
          | 'valid'
          | 'rejected'
          | 'neutral'
          | 'planned'
          | 'review';
        label: string;
      }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'planned', label: 'Planifié' },
      [LeaveRequestStatus.PENDING]: { tone: 'pending', label: 'Soumis' },
      [LeaveRequestStatus.IN_REVIEW]: {
        tone: 'review',
        label: 'En revue RH',
      },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Confirmé RH' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusé' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulé' },
    };

    return map[status];
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

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
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

    const paidPool = leaveTypes.filter((leaveType) =>
      this.isPaidPoolLeaveType(leaveType),
    );
    const specialPool = leaveTypes.filter((leaveType) =>
      this.isSpecialPoolLeaveType(leaveType),
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

    if (paidPool.length) {
      options.push({
        id: POOL_PAYE_CODE,
        code: POOL_PAYE_CODE,
        name: 'Congés payés (total annuel)',
        category: LeaveCategory.CONGE_PAYE,
        requiresProof: paidPool.some((leaveType) => leaveType.requiresProof),
        children: paidPool,
      });
    }

    if (specialPool.length) {
      options.push({
        id: POOL_SPECIAL_CODE,
        code: POOL_SPECIAL_CODE,
        name: 'Congés spéciaux (plafond 12 j)',
        category: LeaveCategory.CONGE_SPECIAL,
        requiresProof: specialPool.some((leaveType) => leaveType.requiresProof),
        children: specialPool,
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

  private isPaidPoolLeaveType(leaveType: { code: string }) {
    return PAID_SOURCE_CODES.has(leaveType.code.trim().toUpperCase());
  }

  private isSpecialPoolLeaveType(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    const code = leaveType.code.trim().toUpperCase();
    if (this.isPaidPoolLeaveType({ code })) return false;
    if (EXCLUDED_SPECIAL_CODES.has(code)) return false;

    return (
      leaveType.category === LeaveCategory.CONGE_SPECIAL ||
      leaveType.category === LeaveCategory.CONGE_PATERNITE ||
      leaveType.category === LeaveCategory.CONGE_MALADIE ||
      code === 'SPE'
    );
  }

  private poolCodeFromLeaveType(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    if (this.isPaidPoolLeaveType(leaveType)) return POOL_PAYE_CODE;
    if (this.isSpecialPoolLeaveType(leaveType)) return POOL_SPECIAL_CODE;

    return null;
  }
}
