import { Injectable } from '@nestjs/common';
import { EventType, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../leave-entitlements/leave-entitlements.service';
import {
  getCurrentLeaveYear,
  getLeaveYearsForPeriod,
} from '../../../common/leave-year';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const PAID_DEBT_SOURCE_CODES = ['CP', 'ANC', 'ENF', 'PASSIF'];
const PAID_DEBT_CARRYOVER_TARGET_CODE = 'CP';

type InitializeYearParams = {
  year: number;
  userIds?: string[];
  leaveTypeIds?: string[];
  client?: PrismaClientLike;
  refreshExisting?: boolean;
};

@Injectable()
export class LeaveBalanceInitializerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
  ) {}

  async initializeYear(params: InitializeYearParams) {
    const client = params.client ?? this.prisma;
    const [employees, leaveTypes] = await Promise.all([
      client.user.findMany({
        where: {
          status: { not: UserStatus.INACTIVE },
          ...(params.userIds?.length ? { id: { in: params.userIds } } : {}),
        },
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
          ...(params.leaveTypeIds?.length
            ? { id: { in: params.leaveTypeIds } }
            : {}),
        },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
    ]);

    const debtCarryoverByUserId = await this.getPaidDebtCarryoverByUserId(
      client,
      employees.map((employee) => employee.id),
      params.year,
    );

    const data = employees.flatMap((employee) =>
      leaveTypes.map((leaveType) => {
        const code = leaveType.code.trim().toUpperCase();
        const debtCarryover =
          code === PAID_DEBT_CARRYOVER_TARGET_CODE
            ? (debtCarryoverByUserId.get(employee.id) ?? 0)
            : 0;

        return {
          leaveTypeCode: code,
          userId: employee.id,
          leaveTypeId: leaveType.id,
          year: params.year,
          acquired: this.leaveEntitlements.getAcquiredDays({
            leaveType,
            user: employee,
            year: params.year,
          }),
          carryover: debtCarryover,
        };
      }),
    );
    const existingBalances = data.length
      ? await client.leaveBalance.findMany({
          where: {
            year: params.year,
            OR: data.map((balance) => ({
              userId: balance.userId,
              leaveTypeId: balance.leaveTypeId,
            })),
          },
          select: {
            userId: true,
            leaveTypeId: true,
            balanceAdjustment: true,
          },
        })
      : [];
    const existingBalanceByKey = new Map(
      existingBalances.map((balance) => [
        this.balanceKey(balance.userId, balance.leaveTypeId),
        balance,
      ]),
    );
    const existingKeys = new Set(
      existingBalances.map((balance) =>
        this.balanceKey(balance.userId, balance.leaveTypeId),
      ),
    );

    const refreshExisting = params.refreshExisting === true;

    await Promise.all(
      data.map(({ leaveTypeCode, ...balance }) => {
        const existingBalance = existingBalanceByKey.get(
          this.balanceKey(balance.userId, balance.leaveTypeId),
        );
        const balanceAdjustment = this.roundDays(
          existingBalance?.balanceAdjustment ?? 0,
        );

        return client.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: balance.userId,
              leaveTypeId: balance.leaveTypeId,
              year: params.year,
            },
          },
          create: {
            ...balance,
            balanceAdjustment: 0,
            taken: 0,
            scheduled: 0,
          },
          update: refreshExisting
            ? {
                acquired: balance.acquired,
                ...(leaveTypeCode === PAID_DEBT_CARRYOVER_TARGET_CODE
                  ? {
                      carryover: this.roundDays(
                        balance.carryover + balanceAdjustment,
                      ),
                    }
                  : {}),
              }
            : {},
        });
      }),
    );

    const created = data.filter(
      (balance) =>
        !existingKeys.has(this.balanceKey(balance.userId, balance.leaveTypeId)),
    ).length;

    return {
      year: params.year,
      employees: employees.length,
      leaveTypes: leaveTypes.length,
      expected: data.length,
      created,
      updated: refreshExisting ? data.length - created : 0,
      skipped: refreshExisting ? 0 : data.length - created,
    };
  }

  async initializeUserYear(
    userId: string,
    year: number,
    client: PrismaClientLike = this.prisma,
    refreshExisting = false,
  ) {
    return this.initializeYear({
      year,
      userIds: [userId],
      client,
      refreshExisting,
    });
  }

  async refreshUserEntitlements(
    userId: string,
    client: PrismaClientLike = this.prisma,
  ) {
    const [balances, requests] = await Promise.all([
      client.leaveBalance.findMany({
        where: { userId },
        distinct: ['year'],
        select: { year: true },
      }),
      client.leaveRequest.findMany({
        where: { ownerId: userId },
        select: { startDate: true, endDate: true },
      }),
    ]);
    const years = Array.from(
      new Set([
        getCurrentLeaveYear(),
        ...balances.map((balance) => balance.year),
        ...requests.flatMap((request) =>
          getLeaveYearsForPeriod(request.startDate, request.endDate),
        ),
      ]),
    ).sort((left, right) => left - right);

    for (const year of years) {
      await this.initializeUserYear(userId, year, client, true);
    }

    return { userId, years };
  }

  async refreshPaidDebtCarryover(
    userId: string,
    targetYear: number,
    client: PrismaClientLike = this.prisma,
  ) {
    const [user, leaveType, debtCarryoverByUserId] = await Promise.all([
      client.user.findUnique({
        where: { id: userId },
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
        where: { code: PAID_DEBT_CARRYOVER_TARGET_CODE },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          defaultDays: true,
        },
      }),
      this.getPaidDebtCarryoverByUserId(client, [userId], targetYear),
    ]);

    if (!user || !leaveType) {
      return { userId, year: targetYear, updated: false, carryover: 0 };
    }

    const existingBalance = await client.leaveBalance.findUnique({
      where: {
        userId_leaveTypeId_year: {
          userId,
          leaveTypeId: leaveType.id,
          year: targetYear,
        },
      },
      select: { balanceAdjustment: true },
    });
    const carryover = this.roundDays(
      (debtCarryoverByUserId.get(userId) ?? 0) +
        (existingBalance?.balanceAdjustment ?? 0),
    );
    await client.leaveBalance.upsert({
      where: {
        userId_leaveTypeId_year: {
          userId,
          leaveTypeId: leaveType.id,
          year: targetYear,
        },
      },
      create: {
        userId,
        leaveTypeId: leaveType.id,
        year: targetYear,
        acquired: this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user,
          year: targetYear,
        }),
        carryover,
        balanceAdjustment: 0,
        taken: 0,
        scheduled: 0,
      },
      update: { carryover },
    });

    return { userId, year: targetYear, updated: true, carryover };
  }

  private balanceKey(userId: string, leaveTypeId: string) {
    return `${userId}:${leaveTypeId}`;
  }

  private async getPaidDebtCarryoverByUserId(
    client: PrismaClientLike,
    userIds: string[],
    year: number,
  ) {
    if (!userIds.length) return new Map<string, number>();

    const previousYear = year - 1;
    const previousBalances = await client.leaveBalance.findMany({
      where: {
        userId: { in: userIds },
        year: previousYear,
        leaveType: { code: { in: PAID_DEBT_SOURCE_CODES } },
      },
      select: {
        userId: true,
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
      },
    });
    const remainingByUserId = new Map<string, number>();
    for (const balance of previousBalances) {
      remainingByUserId.set(
        balance.userId,
        this.roundDays(
          (remainingByUserId.get(balance.userId) ?? 0) +
            balance.acquired +
            balance.carryover -
            balance.taken -
            balance.scheduled,
        ),
      );
    }

    return new Map(
      [...remainingByUserId.entries()]
        .filter(([, remaining]) => remaining < 0)
        .map(([userId, remaining]) => [userId, remaining]),
    );
  }

  private roundDays(value: number) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
