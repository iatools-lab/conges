import { Injectable } from '@nestjs/common';
import { EventType, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../leave-entitlements/leave-entitlements.service';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

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

    const data = employees.flatMap((employee) =>
      leaveTypes.map((leaveType) => ({
        userId: employee.id,
        leaveTypeId: leaveType.id,
        year: params.year,
        acquired: this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user: employee,
          year: params.year,
        }),
      })),
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
          select: { userId: true, leaveTypeId: true },
        })
      : [];
    const existingKeys = new Set(
      existingBalances.map((balance) =>
        this.balanceKey(balance.userId, balance.leaveTypeId),
      ),
    );

    const refreshExisting = params.refreshExisting === true;

    await Promise.all(
      data.map((balance) =>
        client.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: balance.userId,
              leaveTypeId: balance.leaveTypeId,
              year: params.year,
            },
          },
          create: {
            ...balance,
            carryover: 0,
            taken: 0,
            scheduled: 0,
          },
          update: refreshExisting ? { acquired: balance.acquired } : {},
        }),
      ),
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
        select: { startDate: true },
      }),
    ]);
    const years = Array.from(
      new Set([
        new Date().getUTCFullYear(),
        ...balances.map((balance) => balance.year),
        ...requests.map((request) => request.startDate.getUTCFullYear()),
      ]),
    ).sort((left, right) => left - right);

    for (const year of years) {
      await this.initializeUserYear(userId, year, client, true);
    }

    return { userId, years };
  }

  private balanceKey(userId: string, leaveTypeId: string) {
    return `${userId}:${leaveTypeId}`;
  }
}
