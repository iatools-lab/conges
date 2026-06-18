import { Injectable } from '@nestjs/common';
import { LeaveRequestStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

type BalanceKey = {
  userId: string;
  leaveTypeId: string;
  year: number;
};

@Injectable()
export class LeaveBalanceSyncService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });

    if (!request) return;

    await this.syncForKey(
      {
        userId: request.ownerId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
      },
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
  }

  async syncYear(year: number, client: PrismaClientLike = this.prisma) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const requests = await client.leaveRequest.findMany({
      where: { startDate: { gte: yearStart, lt: nextYearStart } },
      select: { ownerId: true, leaveTypeId: true, startDate: true },
    });

    await this.syncForKeys(
      requests.map((request) => ({
        userId: request.ownerId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
      })),
      client,
    );
  }

  async syncUserYear(
    userId: string,
    year: number,
    client: PrismaClientLike = this.prisma,
  ) {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const nextYearStart = new Date(Date.UTC(year + 1, 0, 1));
    const requests = await client.leaveRequest.findMany({
      where: {
        ownerId: userId,
        startDate: { gte: yearStart, lt: nextYearStart },
      },
      select: { ownerId: true, leaveTypeId: true, startDate: true },
    });

    await this.syncForKeys(
      requests.map((request) => ({
        userId: request.ownerId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getUTCFullYear(),
      })),
      client,
    );
  }

  private async syncForKey(key: BalanceKey, client: PrismaClientLike) {
    const yearStart = new Date(Date.UTC(key.year, 0, 1));
    const nextYearStart = new Date(Date.UTC(key.year + 1, 0, 1));
    const [approved, scheduled] = await Promise.all([
      client.leaveRequest.aggregate({
        where: {
          ownerId: key.userId,
          leaveTypeId: key.leaveTypeId,
          startDate: { gte: yearStart, lt: nextYearStart },
          status: LeaveRequestStatus.APPROVED,
        },
        _sum: { days: true },
      }),
      client.leaveRequest.aggregate({
        where: {
          ownerId: key.userId,
          leaveTypeId: key.leaveTypeId,
          startDate: { gte: yearStart, lt: nextYearStart },
          OR: [
            {
              status: {
                in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
              },
            },
            {
              status: LeaveRequestStatus.DRAFT,
              submittedAt: null,
            },
          ],
        },
        _sum: { days: true },
      }),
    ]);

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
        acquired: 0,
        carryover: 0,
        taken: this.toNumber(approved._sum.days),
        scheduled: this.toNumber(scheduled._sum.days),
      },
      update: {
        taken: this.toNumber(approved._sum.days),
        scheduled: this.toNumber(scheduled._sum.days),
      },
    });
  }

  private toNumber(value: number | null | undefined) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
