import { Injectable } from '@nestjs/common';
import {
  ConflictSeverity,
  ConflictStatus,
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  Sexe,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

type AnalyticsQuery = {
  dateFrom?: string;
  dateTo?: string;
  year?: string;
  absenceThreshold?: string;
  pendingDays?: string;
  unplannedThreshold?: string;
};

type DepartmentKey = {
  departmentId: string | null;
  departmentCode: string;
  departmentName: string;
};

const DEPARTMENT_SELECT = {
  id: true,
  code: true,
  name: true,
} satisfies Prisma.DepartmentSelect;

const PERSON_SELECT = {
  id: true,
  nom: true,
  prenom: true,
} satisfies Prisma.UserSelect;

const LEAVE_TYPE_SELECT = {
  code: true,
  name: true,
  category: true,
} satisfies Prisma.LeaveTypeSelect;

const BALANCE_SELECT = {
  acquired: true,
  carryover: true,
  taken: true,
  scheduled: true,
  leaveType: { select: LEAVE_TYPE_SELECT },
} satisfies Prisma.LeaveBalanceSelect;

const USER_SELECT = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  sexe: true,
  dateNaissance: true,
  dateEmbauche: true,
  status: true,
  updatedAt: true,
  departmentId: true,
  department: { select: DEPARTMENT_SELECT },
  n1Id: true,
  n1: { select: PERSON_SELECT },
  balances: { select: BALANCE_SELECT },
} satisfies Prisma.UserSelect;

const REQUEST_OWNER_SELECT = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  departmentId: true,
  department: { select: DEPARTMENT_SELECT },
  n1Id: true,
  n1: { select: PERSON_SELECT },
} satisfies Prisma.UserSelect;

const REQUEST_SELECT = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  status: true,
  submittedAt: true,
  decidedAt: true,
  ownerId: true,
  owner: { select: REQUEST_OWNER_SELECT },
  leaveType: { select: LEAVE_TYPE_SELECT },
} satisfies Prisma.LeaveRequestSelect;

const CONFLICT_SELECT = {
  id: true,
  departmentId: true,
  severity: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  reason: true,
} satisfies Prisma.ConflictSelect;

const EVENT_SELECT = {
  id: true,
  type: true,
  eventDate: true,
  processed: true,
  user: {
    select: {
      id: true,
      matricule: true,
      nom: true,
      prenom: true,
      department: { select: DEPARTMENT_SELECT },
    },
  },
} satisfies Prisma.EventSelect;

const VALIDATION_SELECT = {
  validatorId: true,
  decision: true,
  decidedAt: true,
  validator: { select: PERSON_SELECT },
  request: { select: { submittedAt: true } },
} satisfies Prisma.ValidationSelect;

type AnalyticsDepartment = Prisma.DepartmentGetPayload<{
  select: typeof DEPARTMENT_SELECT;
}>;
type AnalyticsUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type AnalyticsLeaveRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof REQUEST_SELECT;
}>;
type AnalyticsConflict = Prisma.ConflictGetPayload<{
  select: typeof CONFLICT_SELECT;
}>;
type AnalyticsEvent = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;
type AnalyticsValidation = Prisma.ValidationGetPayload<{
  select: typeof VALIDATION_SELECT;
}>;

const PAID_CODES = new Set(['CP', 'ANC', 'ENF', 'PASSIF']);
const SPECIAL_CODES = new Set(['SPE', 'PAT', 'MAL']);
const MATERNITY_CODE = 'MAT';
const SPECIAL_CAP_DAYS = 12;
const MATERNITY_ACTIVE_STATUSES = new Set<LeaveRequestStatus>([
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.APPROVED,
]);
const PENDING_REQUEST_STATUSES = new Set<LeaveRequestStatus>([
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
]);
const RISK_REQUEST_STATUSES = new Set<LeaveRequestStatus>([
  LeaveRequestStatus.APPROVED,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.PENDING,
]);
const DECISIVE_VALIDATION_DECISIONS = new Set<ValidationDecision>([
  ValidationDecision.APPROVED,
  ValidationDecision.REJECTED,
]);
const MONTH_LABELS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];
const WEEKDAY_LABELS = [
  'Dimanche',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
];

@Injectable()
export class RhAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async findSummary(query: AnalyticsQuery = {}) {
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;
    const today = this.utcToday();
    const absenceThreshold = this.parseRatio(query.absenceThreshold, 0.3);
    const pendingDays = this.parsePositiveInt(query.pendingDays, 7);
    const unplannedThreshold = this.parsePositiveNumber(
      query.unplannedThreshold,
      5,
    );

    const requestWhere: Prisma.LeaveRequestWhereInput = {
      ...overlapDateWhere(range),
    };
    const eventWhere: Prisma.EventWhereInput = {
      ...(range.dateFrom || range.endExclusive
        ? {
            eventDate: {
              ...(range.dateFrom ? { gte: range.dateFrom } : {}),
              ...(range.endExclusive ? { lt: range.endExclusive } : {}),
            },
          }
        : {}),
    };
    const conflictWhere: Prisma.ConflictWhereInput = {
      ...(range.endExclusive
        ? { periodStart: { lt: range.endExclusive } }
        : {}),
      ...(range.dateFrom ? { periodEnd: { gte: range.dateFrom } } : {}),
    };

    const [departments, users, requests, conflicts, events, validations] =
      await Promise.all([
        this.prisma.department.findMany({
          orderBy: { name: 'asc' },
          select: DEPARTMENT_SELECT,
        }),
        this.prisma.user.findMany({
          select: {
            ...USER_SELECT,
            balances: {
              where: { year },
              select: BALANCE_SELECT,
            },
          },
        }),
        this.prisma.leaveRequest.findMany({
          where: requestWhere,
          select: REQUEST_SELECT,
        }),
        this.prisma.conflict.findMany({
          where: conflictWhere,
          select: CONFLICT_SELECT,
        }),
        this.prisma.event.findMany({
          where: eventWhere,
          select: EVENT_SELECT,
        }),
        this.prisma.validation.findMany({
          where: {
            level: 1,
            decidedAt: {
              ...(range.dateFrom ? { gte: range.dateFrom } : {}),
              ...(range.endExclusive ? { lt: range.endExclusive } : {}),
            },
          },
          select: VALIDATION_SELECT,
        }),
      ]);

    const departmentById = new Map(departments.map((item) => [item.id, item]));
    const activeUsers = users.filter(
      (user) => user.status === UserStatus.ACTIVE,
    );
    const takenRequests = requests.filter(
      (request) =>
        request.status === LeaveRequestStatus.APPROVED &&
        request.endDate < today,
    );
    const plannedOrCurrentMaternity = requests.filter(
      (request) =>
        this.normalizeCode(request.leaveType.code) === MATERNITY_CODE &&
        request.endDate >= today &&
        MATERNITY_ACTIVE_STATUSES.has(request.status),
    );
    const pendingRequests = requests.filter((request) =>
      PENDING_REQUEST_STATUSES.has(request.status),
    );
    const pendingLimit = new Date(today);
    pendingLimit.setUTCDate(pendingLimit.getUTCDate() - pendingDays);

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      generatedAt: new Date().toISOString(),
      thresholds: {
        absence: absenceThreshold,
        pendingDays,
        unplannedDays: unplannedThreshold,
      },
      workforce: this.buildWorkforceAnalytics(
        users,
        activeUsers,
        range,
        unplannedThreshold,
      ),
      leaves: this.buildLeaveAnalytics(
        activeUsers,
        requests,
        takenRequests,
        plannedOrCurrentMaternity,
        year,
      ),
      alerts: this.buildAlertAnalytics(
        activeUsers,
        requests,
        pendingRequests,
        conflicts,
        events,
        departmentById,
        year,
        absenceThreshold,
      ),
      trends: this.buildTrendAnalytics(
        activeUsers,
        requests,
        takenRequests,
        year,
      ),
      management: this.buildManagementAnalytics(
        users,
        pendingRequests,
        validations,
        pendingLimit,
      ),
      balances: this.buildBalanceAnalytics(activeUsers, unplannedThreshold),
      specialEvents: this.buildSpecialEventAnalytics(
        activeUsers,
        takenRequests,
        events,
      ),
    };
  }

  private buildWorkforceAnalytics(
    users: AnalyticsUser[],
    activeUsers: AnalyticsUser[],
    range: ReturnType<typeof resolveDateRange>,
    unplannedThreshold: number,
  ) {
    const departmentRows = this.groupUsersByDepartment(users).map(
      ({ key, rows }) => {
        const active = rows.filter((user) => user.status === UserStatus.ACTIVE);
        const inactive = rows.filter(
          (user) => user.status === UserStatus.INACTIVE,
        );
        const withBirthDate = rows.filter((user) => user.dateNaissance);

        return {
          ...key,
          total: rows.length,
          active: active.length,
          inactive: inactive.length,
          men: rows.filter((user) => user.sexe === Sexe.M).length,
          women: rows.filter((user) => user.sexe === Sexe.F).length,
          averageAge: this.round(
            this.average(
              withBirthDate.map((user) =>
                this.completedYears(user.dateNaissance!, new Date()),
              ),
            ),
          ),
          averageSeniority: this.round(
            this.average(
              rows.map((user) =>
                this.completedYears(user.dateEmbauche, new Date()),
              ),
            ),
          ),
        };
      },
    );

    const inactiveInRange = users.filter(
      (user) =>
        user.status === UserStatus.INACTIVE &&
        this.isDateInRange(user.updatedAt, range),
    ).length;
    const turnoverDenominator = activeUsers.length + inactiveInRange;

    return {
      totals: {
        employees: users.length,
        activeEmployees: activeUsers.length,
        inactiveEmployees: users.length - activeUsers.length,
        departments: departmentRows.length,
        estimatedTurnover: this.roundPercent(
          turnoverDenominator ? inactiveInRange / turnoverDenominator : 0,
        ),
      },
      byDepartment: departmentRows,
      genderByDepartment: departmentRows.map((row) => ({
        departmentCode: row.departmentCode,
        departmentName: row.departmentName,
        men: row.men,
        women: row.women,
      })),
      averageAgeByDepartment: departmentRows.map((row) => ({
        departmentCode: row.departmentCode,
        departmentName: row.departmentName,
        averageAge: row.averageAge,
      })),
      averageSeniorityByDepartment: departmentRows.map((row) => ({
        departmentCode: row.departmentCode,
        departmentName: row.departmentName,
        averageSeniority: row.averageSeniority,
      })),
      turnover: {
        inactiveInPeriod: inactiveInRange,
        estimatedRate: this.roundPercent(
          turnoverDenominator ? inactiveInRange / turnoverDenominator : 0,
        ),
        note: 'Estimation basée sur les employés INACTIVE dont updatedAt tombe dans la période.',
      },
      employeesWithoutManager: activeUsers
        .filter((user) => !user.n1Id)
        .map((user) => this.employeeRow(user)),
      employeesWithoutAnnualPlanning: activeUsers
        .filter((user) => this.sumPaidBalances(user).scheduled === 0)
        .map((user) => ({
          ...this.employeeRow(user),
          remainingToPlan: this.round(
            Math.max(this.sumPaidBalances(user).remaining, unplannedThreshold),
          ),
        })),
    };
  }

  private buildLeaveAnalytics(
    activeUsers: AnalyticsUser[],
    requests: AnalyticsLeaveRequest[],
    takenRequests: AnalyticsLeaveRequest[],
    maternityRequests: AnalyticsLeaveRequest[],
    year: number,
  ) {
    return {
      takenByDepartment: this.groupRequestsByDepartment(takenRequests).map(
        ({ key, rows }) => ({
          ...key,
          days: this.round(this.sum(rows.map((row) => row.days))),
          requests: rows.length,
        }),
      ),
      plannedByDepartment: this.groupUsersByDepartment(activeUsers).map(
        ({ key, rows }) => ({
          ...key,
          days: this.round(
            this.sum(rows.map((user) => this.sumPaidBalances(user).scheduled)),
          ),
        }),
      ),
      specialConsumedByType: this.specialConsumedByType(takenRequests),
      paidConsumptionByDepartment: this.groupUsersByDepartment(activeUsers).map(
        ({ key, rows }) => {
          const acquired = this.sum(
            rows.map((user) => this.sumPaidBalances(user).total),
          );
          const taken = this.sum(
            rows.map((user) => this.sumPaidBalances(user).taken),
          );

          return {
            ...key,
            acquired: this.round(acquired),
            taken: this.round(taken),
            rate: this.roundPercent(acquired ? taken / acquired : 0),
          };
        },
      ),
      monthlyTakenEvolution: this.monthRows(year).map((month) => {
        const rows = takenRequests.filter(
          (request) => request.endDate.getUTCMonth() + 1 === month.month,
        );
        return {
          ...month,
          days: this.round(this.sum(rows.map((row) => row.days))),
          requests: rows.length,
        };
      }),
      topAbsentees: this.topAbsentees(takenRequests),
      maternityOngoingOrPlanned: maternityRequests.map((request) => ({
        id: request.id,
        reference: request.reference,
        employee: this.fullName(request.owner),
        matricule: request.owner.matricule,
        departmentName: request.owner.department?.name ?? 'Sans département',
        startDate: this.formatDate(request.startDate),
        endDate: this.formatDate(request.endDate),
        days: this.round(request.days),
        status: request.status,
      })),
      negativeBalances: this.negativeBalances(activeUsers),
    };
  }

  private buildAlertAnalytics(
    activeUsers: AnalyticsUser[],
    requests: AnalyticsLeaveRequest[],
    pendingRequests: AnalyticsLeaveRequest[],
    conflicts: AnalyticsConflict[],
    events: AnalyticsEvent[],
    departmentById: Map<string, AnalyticsDepartment>,
    year: number,
    absenceThreshold: number,
  ) {
    const activeConflicts = conflicts.filter(
      (conflict) => conflict.status === ConflictStatus.ACTIVE,
    );

    return {
      conflictsByDepartment: this.groupConflictsByDepartment(
        activeConflicts,
        departmentById,
      ),
      conflictsBySeverity: Object.values(ConflictSeverity).map((severity) => ({
        severity,
        count: activeConflicts.filter(
          (conflict) => conflict.severity === severity,
        ).length,
      })),
      riskPeriods: this.riskPeriods(
        activeUsers,
        requests,
        year,
        absenceThreshold,
      ),
      pendingRequests: {
        total: pendingRequests.length,
        byStatus: [
          LeaveRequestStatus.PENDING,
          LeaveRequestStatus.IN_REVIEW,
        ].map((status) => ({
          status,
          count: pendingRequests.filter((request) => request.status === status)
            .length,
        })),
        rows: pendingRequests.slice(0, 20).map((request) => ({
          id: request.id,
          reference: request.reference,
          employee: this.fullName(request.owner),
          departmentName: request.owner.department?.name ?? 'Sans département',
          type: this.parentLeaveTypeLabel(request.leaveType),
          submittedAt: request.submittedAt?.toISOString() ?? null,
          status: request.status,
        })),
      },
      unprocessedEvents: events
        .filter((event) => !event.processed)
        .map((event) => ({
          id: event.id,
          employee: this.fullName(event.user),
          matricule: event.user.matricule,
          departmentName: event.user.department?.name ?? 'Sans département',
          type: event.type,
          eventDate: this.formatDate(event.eventDate),
        })),
    };
  }

  private buildTrendAnalytics(
    activeUsers: AnalyticsUser[],
    requests: AnalyticsLeaveRequest[],
    takenRequests: AnalyticsLeaveRequest[],
    year: number,
  ) {
    const monthlyAbsenceRate = this.monthRows(year).map((month) => {
      const rows = takenRequests.filter(
        (request) => request.endDate.getUTCMonth() + 1 === month.month,
      );
      const absenceDays = this.sum(rows.map((request) => request.days));
      const capacity =
        this.workingDaysInMonth(year, month.month) * activeUsers.length;

      return {
        ...month,
        absenceDays: this.round(absenceDays),
        rate: this.roundPercent(capacity ? absenceDays / capacity : 0),
      };
    });
    const leaveTypes = this.groupBy(requests, (request) =>
      this.parentLeaveTypeLabel(request.leaveType),
    ).map(([type, rows]) => ({
      type,
      requests: rows.length,
      days: this.round(this.sum(rows.map((request) => request.days))),
    }));

    return {
      monthlyAbsenceRate,
      busiestMonths: [...monthlyAbsenceRate]
        .sort((left, right) => right.absenceDays - left.absenceDays)
        .slice(0, 5),
      mostUsedLeaveTypes: leaveTypes.sort(
        (left, right) => right.days - left.days,
      ),
      requestedWeekdays: this.weekdays(requests),
      averageDurationByDepartment: this.groupRequestsByDepartment(requests).map(
        ({ key, rows }) => ({
          ...key,
          averageDays: this.round(this.average(rows.map((row) => row.days))),
          requests: rows.length,
        }),
      ),
    };
  }

  private buildManagementAnalytics(
    users: AnalyticsUser[],
    pendingRequests: AnalyticsLeaveRequest[],
    validations: AnalyticsValidation[],
    pendingLimit: Date,
  ) {
    const managerById = new Map(
      users
        .filter((user) => user.id)
        .map((user) => [user.id, this.fullName(user)]),
    );

    return {
      supervisedCounts: this.groupBy(
        users.filter((user) => user.n1Id),
        (user) => user.n1Id!,
      ).map(([managerId, rows]) => ({
        managerId,
        manager: managerById.get(managerId) ?? 'Manager inconnu',
        employees: rows.length,
      })),
      averageValidationDelay: this.groupBy(
        validations.filter(
          (validation) =>
            validation.request.submittedAt && validation.decidedAt,
        ),
        (validation) => validation.validatorId,
      ).map(([managerId, rows]) => ({
        managerId,
        manager: rows[0]?.validator
          ? this.fullName(rows[0].validator)
          : (managerById.get(managerId) ?? 'Manager inconnu'),
        averageHours: this.round(
          this.average(
            rows.map((row) =>
              this.diffHours(row.request.submittedAt!, row.decidedAt),
            ),
          ),
        ),
      })),
      managersWithPending: this.groupBy(
        pendingRequests.filter(
          (request) =>
            request.owner.n1Id &&
            request.submittedAt &&
            request.submittedAt < pendingLimit,
        ),
        (request) => request.owner.n1Id!,
      ).map(([managerId, rows]) => ({
        managerId,
        manager: rows[0]?.owner.n1
          ? this.fullName(rows[0].owner.n1)
          : (managerById.get(managerId) ?? 'Manager inconnu'),
        pending: rows.length,
        oldestSubmittedAt: rows
          .map((row) => row.submittedAt)
          .filter(Boolean)
          .sort((left, right) => left!.getTime() - right!.getTime())[0]
          ?.toISOString(),
      })),
      approvalRateByManager: this.groupBy(
        validations.filter((validation) =>
          DECISIVE_VALIDATION_DECISIONS.has(validation.decision),
        ),
        (validation) => validation.validatorId,
      ).map(([managerId, rows]) => {
        const approved = rows.filter(
          (row) => row.decision === ValidationDecision.APPROVED,
        ).length;
        const rejected = rows.filter(
          (row) => row.decision === ValidationDecision.REJECTED,
        ).length;
        return {
          managerId,
          manager: rows[0]?.validator
            ? this.fullName(rows[0].validator)
            : (managerById.get(managerId) ?? 'Manager inconnu'),
          approved,
          rejected,
          rate: this.roundPercent(rows.length ? approved / rows.length : 0),
        };
      }),
    };
  }

  private buildBalanceAnalytics(
    activeUsers: AnalyticsUser[],
    unplannedThreshold: number,
  ) {
    const rows = activeUsers.map((user) => ({
      ...this.employeeRow(user),
      ...this.sumPaidBalances(user),
    }));

    return {
      lowCpBalance: rows.filter((row) => row.remaining < 5),
      highCpBalance: rows.filter((row) => row.remaining > 30),
      unplannedLeave: rows
        .filter((row) => row.remaining > unplannedThreshold)
        .map((row) => ({ ...row, unplannedDays: row.remaining })),
      carryoverByDepartment: this.groupUsersByDepartment(activeUsers).map(
        ({ key, rows: users }) => ({
          ...key,
          carryover: this.round(
            this.sum(users.map((user) => this.sumPaidBalances(user).carryover)),
          ),
        }),
      ),
      employeesWithoutLeaveTaken: rows.filter((row) => row.taken === 0),
    };
  }

  private buildSpecialEventAnalytics(
    activeUsers: AnalyticsUser[],
    takenRequests: AnalyticsLeaveRequest[],
    events: AnalyticsEvent[],
  ) {
    return {
      declaredEvents: [
        EventType.BIRTH,
        EventType.MARRIAGE,
        EventType.DEATH,
      ].map((type) => ({
        type,
        count: events.filter((event) => event.type === type).length,
      })),
      eventsByDepartment: this.groupBy(
        events,
        (event) => this.departmentKey(event.user.department).departmentCode,
      ).map(([, rows]) => ({
        ...this.departmentKey(rows[0]?.user.department),
        total: rows.length,
        births: rows.filter((event) => event.type === EventType.BIRTH).length,
        marriages: rows.filter((event) => event.type === EventType.MARRIAGE)
          .length,
        deaths: rows.filter((event) => event.type === EventType.DEATH).length,
      })),
      specialConsumedByType: this.specialConsumedByType(takenRequests),
      employeesReachedAnnualCap: activeUsers
        .filter(
          (user) => this.sumSpecialBalances(user).used >= SPECIAL_CAP_DAYS,
        )
        .map((user) => ({
          ...this.employeeRow(user),
          used: this.sumSpecialBalances(user).used,
          cap: SPECIAL_CAP_DAYS,
        })),
    };
  }

  private groupUsersByDepartment(users: AnalyticsUser[]) {
    return this.groupBy(
      users,
      (user) => this.departmentKey(user.department).departmentCode,
    ).map(([, rows]) => ({
      key: this.departmentKey(rows[0]?.department),
      rows,
    }));
  }

  private groupRequestsByDepartment(requests: AnalyticsLeaveRequest[]) {
    return this.groupBy(
      requests,
      (request) => this.departmentKey(request.owner.department).departmentCode,
    ).map(([, rows]) => ({
      key: this.departmentKey(rows[0]?.owner.department),
      rows,
    }));
  }

  private groupConflictsByDepartment(
    conflicts: AnalyticsConflict[],
    departmentById: Map<string, AnalyticsDepartment>,
  ) {
    return this.groupBy(
      conflicts,
      (conflict) => conflict.departmentId ?? 'NONE',
    ).map(([departmentId, rows]) => {
      const department =
        departmentId === 'NONE' ? null : departmentById.get(departmentId);
      return {
        departmentId: department?.id ?? null,
        departmentCode: department?.code ?? 'NONE',
        departmentName: department?.name ?? 'Sans département',
        conflicts: rows.length,
        high: rows.filter((row) => row.severity === ConflictSeverity.HIGH)
          .length,
        medium: rows.filter((row) => row.severity === ConflictSeverity.MEDIUM)
          .length,
        low: rows.filter((row) => row.severity === ConflictSeverity.LOW).length,
      };
    });
  }

  private topAbsentees(requests: AnalyticsLeaveRequest[]) {
    return this.groupBy(requests, (request) => request.ownerId)
      .map(([, rows]) => ({
        employeeId: rows[0].ownerId,
        employee: this.fullName(rows[0].owner),
        matricule: rows[0].owner.matricule,
        departmentName: rows[0].owner.department?.name ?? 'Sans département',
        days: this.round(this.sum(rows.map((row) => row.days))),
        requests: rows.length,
      }))
      .sort((left, right) => right.days - left.days)
      .slice(0, 5);
  }

  private negativeBalances(users: AnalyticsUser[]) {
    return users.flatMap((user) =>
      user.balances
        .map((balance) => ({
          ...this.employeeRow(user),
          type: balance.leaveType.name,
          code: balance.leaveType.code,
          remaining: this.round(
            balance.acquired +
              balance.carryover -
              balance.taken -
              balance.scheduled,
          ),
        }))
        .filter((balance) => balance.remaining < 0),
    );
  }

  private riskPeriods(
    activeUsers: AnalyticsUser[],
    requests: AnalyticsLeaveRequest[],
    year: number,
    threshold: number,
  ) {
    return this.monthRows(year)
      .map((month) => {
        const rows = requests.filter(
          (request) =>
            RISK_REQUEST_STATUSES.has(request.status) &&
            request.startDate.getUTCMonth() + 1 === month.month,
        );
        const days = this.sum(rows.map((row) => row.days));
        const capacity =
          this.workingDaysInMonth(year, month.month) * activeUsers.length;
        const rate = capacity ? days / capacity : 0;

        return {
          ...month,
          days: this.round(days),
          rate: this.roundPercent(rate),
          threshold: this.roundPercent(threshold),
          risky: rate >= threshold,
        };
      })
      .filter((month) => month.risky);
  }

  private specialConsumedByType(requests: AnalyticsLeaveRequest[]) {
    return this.groupBy(
      requests.filter((request) => this.isSpecialLeaveType(request.leaveType)),
      (request) => request.leaveType.code,
    ).map(([code, rows]) => ({
      code,
      type: rows[0]?.leaveType.name ?? code,
      days: this.round(this.sum(rows.map((row) => row.days))),
      requests: rows.length,
    }));
  }

  private weekdays(requests: AnalyticsLeaveRequest[]) {
    return WEEKDAY_LABELS.map((label, weekday) => ({
      weekday,
      label,
      requests: requests.filter(
        (request) => request.startDate.getUTCDay() === weekday,
      ).length,
    })).sort((left, right) => right.requests - left.requests);
  }

  private sumPaidBalances(user: {
    balances: {
      acquired: number;
      carryover: number;
      taken: number;
      scheduled: number;
      leaveType: { code: string; category: LeaveCategory };
    }[];
  }) {
    const balances = user.balances.filter((balance) =>
      this.isPaidLeaveType(balance.leaveType),
    );
    const total = this.sum(
      balances.map((balance) => balance.acquired + balance.carryover),
    );
    const taken = this.sum(balances.map((balance) => balance.taken));
    const scheduled = this.sum(balances.map((balance) => balance.scheduled));
    const carryover = this.sum(balances.map((balance) => balance.carryover));

    return {
      total: this.round(total),
      taken: this.round(taken),
      scheduled: this.round(scheduled),
      carryover: this.round(carryover),
      remaining: this.round(total - taken - scheduled),
    };
  }

  private sumSpecialBalances(user: {
    balances: {
      taken: number;
      scheduled: number;
      leaveType: { code: string; category: LeaveCategory };
    }[];
  }) {
    const used = this.sum(
      user.balances
        .filter((balance) => this.isSpecialLeaveType(balance.leaveType))
        .map((balance) => balance.taken + balance.scheduled),
    );

    return { used: this.round(used) };
  }

  private isPaidLeaveType(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    return (
      leaveType.category === LeaveCategory.CONGE_PAYE ||
      PAID_CODES.has(this.normalizeCode(leaveType.code))
    );
  }

  private isSpecialLeaveType(leaveType: {
    code: string;
    category: LeaveCategory;
  }) {
    const code = this.normalizeCode(leaveType.code);
    return (
      SPECIAL_CODES.has(code) ||
      leaveType.category === LeaveCategory.CONGE_SPECIAL ||
      leaveType.category === LeaveCategory.CONGE_PATERNITE ||
      leaveType.category === LeaveCategory.CONGE_MALADIE
    );
  }

  private parentLeaveTypeLabel(leaveType: {
    code: string;
    name: string;
    category: LeaveCategory;
  }) {
    const code = this.normalizeCode(leaveType.code);

    if (this.isPaidLeaveType(leaveType)) return 'Congés payés';
    if (
      code === MATERNITY_CODE ||
      leaveType.category === LeaveCategory.CONGE_MATERNITE
    ) {
      return 'Congé maternité';
    }
    if (this.isSpecialLeaveType(leaveType)) return 'Congés spéciaux';

    return leaveType.name;
  }

  private employeeRow(user: {
    id: string;
    matricule: string;
    nom: string;
    prenom: string;
    department?: { code: string; name: string } | null;
  }) {
    return {
      id: user.id,
      employee: this.fullName(user),
      matricule: user.matricule,
      departmentCode: user.department?.code ?? 'NONE',
      departmentName: user.department?.name ?? 'Sans département',
    };
  }

  private departmentKey(
    department?: { id?: string; code: string; name: string } | null,
  ): DepartmentKey {
    return {
      departmentId: department?.id ?? null,
      departmentCode: department?.code ?? 'NONE',
      departmentName: department?.name ?? 'Sans département',
    };
  }

  private monthRows(year: number) {
    return MONTH_LABELS.map((label, index) => ({
      year,
      month: index + 1,
      label,
    }));
  }

  private workingDaysInMonth(year: number, month: number) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let count = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      if (weekday !== 0 && weekday !== 6) count += 1;
    }
    return count;
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string) {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return Array.from(map.entries());
  }

  private fullName(user?: { nom: string; prenom: string } | null) {
    if (!user) return '';
    return `${user.prenom} ${user.nom}`.trim();
  }

  private completedYears(startDate: Date, referenceDate: Date) {
    let years = referenceDate.getUTCFullYear() - startDate.getUTCFullYear();
    const beforeAnniversary =
      referenceDate.getUTCMonth() < startDate.getUTCMonth() ||
      (referenceDate.getUTCMonth() === startDate.getUTCMonth() &&
        referenceDate.getUTCDate() < startDate.getUTCDate());

    if (beforeAnniversary) years -= 1;
    return Math.max(years, 0);
  }

  private isDateInRange(
    date: Date,
    range: ReturnType<typeof resolveDateRange>,
  ) {
    return (
      (!range.dateFrom || date >= range.dateFrom) &&
      (!range.endExclusive || date < range.endExclusive)
    );
  }

  private utcToday() {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private diffHours(start: Date, end: Date) {
    return Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private normalizeCode(code: string) {
    return code.trim().toUpperCase();
  }

  private average(values: number[]) {
    if (!values.length) return 0;
    return this.sum(values) / values.length;
  }

  private sum(values: number[]) {
    return values.reduce((total, value) => total + Number(value ?? 0), 0);
  }

  private round(value: number) {
    return Math.round(value * 10) / 10;
  }

  private roundPercent(value: number) {
    return Math.round(value * 1000) / 10;
  }

  private parseRatio(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed > 1 ? parsed / 100 : parsed;
  }

  private parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parsePositiveNumber(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
