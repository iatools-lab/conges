import { Injectable } from '@nestjs/common';
import { EventType, LeaveRequestStatus, Prisma } from '@prisma/client';
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
            startDate: { lt: range.endExclusive },
            endDate: { gte: range.start },
          },
          select: {
            startDate: true,
            endDate: true,
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
    request: { startDate: Date; endDate: Date },
    year: number,
    holidays: { date: Date; recurring: boolean }[],
  ) {
    return this.toNumber(
      splitPeriodByLeaveYear(request.startDate, request.endDate)
        .filter((segment) => segment.year === year)
        .reduce(
          (total, segment) =>
            total +
            countWorkingDays(segment.startDate, segment.endDate, holidays),
          0,
        ),
    );
  }

  private toNumber(value: number | null | undefined) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
