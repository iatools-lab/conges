import { Injectable } from '@nestjs/common';
import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Prisma,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../leave-entitlements/leave-entitlements.service';
import { LeaveBalanceInitializerService } from './leave-balance-initializer.service';
import {
  getLeaveYearRange,
  getLeaveYearsForPeriod,
  splitPeriodByLeaveYear,
} from '../../../common/leave-year';
import { countWorkingDays } from '../../../common/working-days';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

type BalanceKey = {
  userId: string;
  leaveTypeId: string;
  year: number;
};

type RequestSnapshot = {
  userId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
};

const PAID_BALANCE_CODES = ['CP', 'ANC', 'ENF', 'PASSIF'] as const;
const PAID_CONSUMPTION_ORDER = ['ANC', 'CP', 'ENF', 'PASSIF'] as const;
const BALANCE_TRACKED_REQUEST_STATUSES = [
  LeaveRequestStatus.DRAFT,
  LeaveRequestStatus.PENDING,
  LeaveRequestStatus.IN_REVIEW,
  LeaveRequestStatus.APPROVED,
];

@Injectable()
export class LeaveBalanceSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
  ) {}

  async syncForRequest(
    requestId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    const request = await client.leaveRequest.findUnique({
      where: { id: requestId },
      select: {
        ownerId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!request) return;

    await this.syncForRequestSnapshot(
      {
        userId: request.ownerId,
        leaveTypeId: request.leaveTypeId,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      client,
    );
  }

  async syncForRequestSnapshot(
    request: RequestSnapshot,
    client: PrismaClientLike = this.prisma,
  ) {
    await this.syncForKeys(
      getLeaveYearsForPeriod(request.startDate, request.endDate).map(
        (year) => ({
          userId: request.userId,
          leaveTypeId: request.leaveTypeId,
          year,
        }),
      ),
      client,
    );
  }

  async syncForKeys(
    keys: BalanceKey[],
    client: PrismaClientLike = this.prisma,
  ) {
    const uniqueKeys = Array.from(
      new Map(
        keys.map((key) => [
          `${key.userId}:${key.leaveTypeId}:${key.year}`,
          key,
        ]),
      ).values(),
    );

    await Promise.all(uniqueKeys.map((key) => this.syncForKey(key, client)));
    await Promise.all(
      this.paidPoolKeys(uniqueKeys).map((key) =>
        this.syncPaidPoolForUserYear(key, client),
      ),
    );
    await Promise.all(
      this.nextYearDebtKeys(uniqueKeys).map((key) =>
        this.leaveBalanceInitializer.refreshPaidDebtCarryover(
          key.userId,
          key.year,
          client,
        ),
      ),
    );
  }

  async syncYear(year: number, client: PrismaClientLike = this.prisma) {
    const range = getLeaveYearRange(year);
    await this.repairWorkflowStatuses({ range }, client);
    const requests = await client.leaveRequest.findMany({
      where: {
        startDate: { lt: range.endExclusive },
        endDate: { gte: range.start },
      },
      select: {
        ownerId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
      },
    });

    await this.syncForKeys(
      requests.flatMap((request) =>
        getLeaveYearsForPeriod(request.startDate, request.endDate).map(
          (leaveYear) => ({
            userId: request.ownerId,
            leaveTypeId: request.leaveTypeId,
            year: leaveYear,
          }),
        ),
      ),
      client,
    );
  }

  async syncUserYear(
    userId: string,
    year: number,
    client: PrismaClientLike = this.prisma,
  ) {
    const range = getLeaveYearRange(year);
    await this.repairWorkflowStatuses({ range, userId }, client);
    const requests = await client.leaveRequest.findMany({
      where: {
        ownerId: userId,
        startDate: { lt: range.endExclusive },
        endDate: { gte: range.start },
      },
      select: {
        ownerId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
      },
    });

    await this.syncForKeys(
      requests.flatMap((request) =>
        getLeaveYearsForPeriod(request.startDate, request.endDate).map(
          (leaveYear) => ({
            userId: request.ownerId,
            leaveTypeId: request.leaveTypeId,
            year: leaveYear,
          }),
        ),
      ),
      client,
    );
  }

  private async repairWorkflowStatuses(
    params: {
      range: { start: Date; endExclusive: Date };
      userId?: string;
    },
    client: PrismaClientLike,
  ) {
    const requests = await client.leaveRequest.findMany({
      where: {
        ...(params.userId ? { ownerId: params.userId } : {}),
        status: {
          in: [
            LeaveRequestStatus.DRAFT,
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.IN_REVIEW,
          ],
        },
        startDate: { lt: params.range.endExclusive },
        endDate: { gte: params.range.start },
      },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        validations: {
          orderBy: [{ decidedAt: 'desc' }],
          take: 8,
          select: {
            level: true,
            decision: true,
            decidedAt: true,
          },
        },
      },
    });

    await Promise.all(
      requests.flatMap((request) => {
        const repair = this.deriveWorkflowStatusRepair(request);
        if (!repair || repair.status === request.status) return [];

        return [
          client.leaveRequest.update({
            where: { id: request.id },
            data: {
              status: repair.status,
              decidedAt: repair.decidedAt,
              cancelledAt: null,
            },
          }),
        ];
      }),
    );
  }

  private deriveWorkflowStatusRepair(request: {
    status: LeaveRequestStatus;
    submittedAt: Date | null;
    validations: Array<{
      level: number;
      decision: ValidationDecision;
      decidedAt: Date;
    }>;
  }) {
    const latestValidation = request.validations[0];
    if (latestValidation?.decision === ValidationDecision.REVIEW_REQUESTED) {
      return { status: LeaveRequestStatus.DRAFT, decidedAt: null };
    }

    const latestRhFinalDecision = request.validations.find(
      (validation) =>
        validation.level === 3 &&
        (validation.decision === ValidationDecision.APPROVED ||
          validation.decision === ValidationDecision.REJECTED),
    );
    if (latestRhFinalDecision) {
      return {
        status:
          latestRhFinalDecision.decision === ValidationDecision.APPROVED
            ? LeaveRequestStatus.APPROVED
            : LeaveRequestStatus.REJECTED,
        decidedAt: latestRhFinalDecision.decidedAt,
      };
    }

    const latestManagerDecision = request.validations.find(
      (validation) =>
        validation.level === 1 &&
        (validation.decision === ValidationDecision.APPROVED ||
          validation.decision === ValidationDecision.REJECTED),
    );
    if (latestManagerDecision?.decision === ValidationDecision.REJECTED) {
      return {
        status: LeaveRequestStatus.REJECTED,
        decidedAt: latestManagerDecision.decidedAt,
      };
    }
    if (latestManagerDecision?.decision === ValidationDecision.APPROVED) {
      return { status: LeaveRequestStatus.IN_REVIEW, decidedAt: null };
    }

    if (
      request.status === LeaveRequestStatus.DRAFT &&
      request.submittedAt !== null
    ) {
      return { status: LeaveRequestStatus.PENDING, decidedAt: null };
    }

    return null;
  }

  private async syncForKey(key: BalanceKey, client: PrismaClientLike) {
    const range = getLeaveYearRange(key.year);
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [requests, holidays, existingBalance, user, leaveType] =
      await Promise.all([
        client.leaveRequest.findMany({
          where: {
            ownerId: key.userId,
            leaveTypeId: key.leaveTypeId,
            status: { in: BALANCE_TRACKED_REQUEST_STATUSES },
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
              { date: { gte: range.start, lt: range.endExclusive } },
              { recurring: true },
            ],
          },
          select: { date: true, recurring: true },
        }),
        client.leaveBalance.findUnique({
          where: {
            userId_leaveTypeId_year: {
              userId: key.userId,
              leaveTypeId: key.leaveTypeId,
              year: key.year,
            },
          },
          select: { acquired: true, takenAdjustment: true },
        }),
        client.user.findUnique({
          where: { id: key.userId },
          select: {
            id: true,
            sexe: true,
            dateEmbauche: true,
            passifInitial: true,
            children: { select: { dateNaissance: true } },
            events: {
              where: { type: EventType.BIRTH, processed: true },
              select: { type: true, eventDate: true, processed: true },
            },
          },
        }),
        client.leaveType.findUnique({
          where: { id: key.leaveTypeId },
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            defaultDays: true,
          },
        }),
      ]);
    const takenAdjustment = this.toNumber(
      existingBalance?.takenAdjustment ?? 0,
    );
    const taken = this.toNumber(
      requests
        .filter((request) => this.isTakenRequest(request, today))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, key.year, holidays),
          0,
        ) + takenAdjustment,
    );
    const scheduled = this.toNumber(
      requests
        .filter((request) => this.isScheduledRequest(request, today))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, key.year, holidays),
          0,
        ),
    );
    const acquired =
      user && leaveType
        ? this.leaveEntitlements.getAcquiredDays({
            leaveType,
            user,
            year: key.year,
          })
        : (existingBalance?.acquired ?? 0);

    await client.leaveBalance.upsert({
      where: {
        userId_leaveTypeId_year: {
          userId: key.userId,
          leaveTypeId: key.leaveTypeId,
          year: key.year,
        },
      },
      create: {
        userId: key.userId,
        leaveTypeId: key.leaveTypeId,
        year: key.year,
        acquired,
        carryover: 0,
        balanceAdjustment: 0,
        taken,
        takenAdjustment,
        scheduled,
      },
      update: {
        taken,
        scheduled,
      },
    });
  }

  private async syncPaidPoolForUserYear(
    key: { userId: string; year: number },
    client: PrismaClientLike,
  ) {
    const range = getLeaveYearRange(key.year);
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [user, leaveTypes, requests, holidays, existingBalances] =
      await Promise.all([
        client.user.findUnique({
          where: { id: key.userId },
          select: {
            id: true,
            sexe: true,
            dateEmbauche: true,
            passifInitial: true,
            children: { select: { dateNaissance: true } },
            events: {
              where: { type: EventType.BIRTH, processed: true },
              select: { type: true, eventDate: true, processed: true },
            },
          },
        }),
        client.leaveType.findMany({
          where: {
            active: true,
            OR: [
              { category: LeaveCategory.CONGE_PAYE },
              { code: { in: [...PAID_BALANCE_CODES] } },
            ],
          },
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
            ownerId: key.userId,
            status: { in: BALANCE_TRACKED_REQUEST_STATUSES },
            startDate: { lt: range.endExclusive },
            endDate: { gte: range.start },
            leaveType: {
              OR: [
                { category: LeaveCategory.CONGE_PAYE },
                { code: { in: [...PAID_BALANCE_CODES] } },
              ],
            },
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
              { date: { gte: range.start, lt: range.endExclusive } },
              { recurring: true },
            ],
          },
          select: { date: true, recurring: true },
        }),
        client.leaveBalance.findMany({
          where: {
            userId: key.userId,
            year: key.year,
            leaveType: {
              OR: [
                { category: LeaveCategory.CONGE_PAYE },
                { code: { in: [...PAID_BALANCE_CODES] } },
              ],
            },
          },
          select: {
            leaveTypeId: true,
            carryover: true,
            takenAdjustment: true,
          },
        }),
      ]);

    if (!user || leaveTypes.length === 0 || requests.length === 0) return;

    const existingBalanceByLeaveTypeId = new Map(
      existingBalances.map((balance) => [balance.leaveTypeId, balance]),
    );
    const takenAdjustment = this.toNumber(
      existingBalances.reduce(
        (sum, balance) => sum + (balance.takenAdjustment ?? 0),
        0,
      ),
    );
    const totalTaken = this.toNumber(
      requests
        .filter((request) => this.isTakenRequest(request, today))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, key.year, holidays),
          0,
        ) + takenAdjustment,
    );
    const totalScheduled = this.toNumber(
      requests
        .filter((request) => this.isScheduledRequest(request, today))
        .reduce(
          (total, request) =>
            total + this.daysInLeaveYear(request, key.year, holidays),
          0,
        ),
    );
    const orderedLeaveTypes = [...leaveTypes].sort(
      (left, right) =>
        this.paidConsumptionRank(left.code) -
        this.paidConsumptionRank(right.code),
    );
    const consumptionHolder = orderedLeaveTypes[0];

    await Promise.all(
      orderedLeaveTypes.map((leaveType) => {
        const existingBalance = existingBalanceByLeaveTypeId.get(leaveType.id);
        const isConsumptionHolder = leaveType.id === consumptionHolder.id;

        return client.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: key.userId,
              leaveTypeId: leaveType.id,
              year: key.year,
            },
          },
          create: {
            userId: key.userId,
            leaveTypeId: leaveType.id,
            year: key.year,
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year: key.year,
            }),
            carryover: existingBalance?.carryover ?? 0,
            balanceAdjustment: 0,
            taken: isConsumptionHolder ? totalTaken : 0,
            takenAdjustment: existingBalance?.takenAdjustment ?? 0,
            scheduled: isConsumptionHolder ? totalScheduled : 0,
          },
          update: {
            acquired: this.leaveEntitlements.getAcquiredDays({
              leaveType,
              user,
              year: key.year,
            }),
            taken: isConsumptionHolder ? totalTaken : 0,
            scheduled: isConsumptionHolder ? totalScheduled : 0,
          },
        });
      }),
    );
  }

  private paidPoolKeys(keys: BalanceKey[]) {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.userId}:${key.year}`,
          { userId: key.userId, year: key.year },
        ]),
      ).values(),
    );
  }

  private paidConsumptionRank(code: string) {
    const normalized = code.trim().toUpperCase();
    const index = PAID_CONSUMPTION_ORDER.indexOf(
      normalized as (typeof PAID_CONSUMPTION_ORDER)[number],
    );

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }

  private nextYearDebtKeys(keys: BalanceKey[]) {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.userId}:${key.year + 1}`,
          { userId: key.userId, year: key.year + 1 },
        ]),
      ).values(),
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

  private toNumber(value: number | null | undefined) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
