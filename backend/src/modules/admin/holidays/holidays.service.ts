import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  countWorkingDays,
  endDateForWorkingDays,
} from '../../../common/working-days';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';

@Injectable()
export class AdminHolidaysService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async onModuleInit() {
    await this.recalculateAffectedRequests([], true);
  }

  async findMany(year?: number, country?: string) {
    const where: Prisma.PublicHolidayWhereInput = {};
    if (country) where.country = country;
    if (year) {
      const start = new Date(Date.UTC(year, 0, 1));
      const end = new Date(Date.UTC(year + 1, 0, 1));
      where.date = { gte: start, lt: end };
    }

    const rows = await this.prisma.publicHoliday.findMany({
      where,
      orderBy: { date: 'asc' },
    });

    return { rows };
  }

  async findOne(id: string) {
    const holiday = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!holiday) throw new NotFoundException('Holiday not found');

    return holiday;
  }

  async create(dto: CreateHolidayDto) {
    const date = new Date(dto.date);
    const country = dto.country?.trim().toUpperCase() || 'CM';
    const created = await this.prisma.publicHoliday.create({
      data: {
        date,
        name: dto.name,
        country,
        recurring: dto.recurring ?? false,
      },
    });

    if (country === 'CM') {
      await this.recalculateAffectedRequests([created.date], created.recurring);
    }

    return created;
  }

  async update(id: string, dto: UpdateHolidayDto) {
    const exists = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('Holiday not found');

    const data: Prisma.PublicHolidayUpdateInput = {};
    if (dto.date) data.date = new Date(dto.date);
    if (dto.name) data.name = dto.name;
    if (dto.country) data.country = dto.country.trim().toUpperCase();
    if (typeof dto.recurring !== 'undefined') data.recurring = dto.recurring;

    const updated = await this.prisma.publicHoliday.update({
      where: { id },
      data,
    });

    const affectedDates = [
      ...(exists.country === 'CM' ? [exists.date] : []),
      ...(updated.country === 'CM' ? [updated.date] : []),
    ];
    await this.recalculateAffectedRequests(
      affectedDates,
      (exists.country === 'CM' && exists.recurring) ||
        (updated.country === 'CM' && updated.recurring),
    );

    return updated;
  }

  async remove(id: string) {
    const exists = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('Holiday not found');

    await this.prisma.publicHoliday.delete({ where: { id } });
    if (exists.country === 'CM') {
      await this.recalculateAffectedRequests([exists.date], exists.recurring);
    }

    return { deleted: true };
  }

  private async recalculateAffectedRequests(
    affectedDates: Date[],
    recalculateAll: boolean,
  ) {
    if (!recalculateAll && affectedDates.length === 0) return;

    const where: Prisma.LeaveRequestWhereInput = recalculateAll
      ? {}
      : {
          OR: affectedDates.map((date) => ({
            startDate: { lte: date },
            endDate: { gte: date },
          })),
        };
    const requests = await this.prisma.leaveRequest.findMany({
      where,
      select: {
        id: true,
        ownerId: true,
        leaveTypeId: true,
        startDate: true,
        endDate: true,
        days: true,
        leaveType: { select: { code: true } },
      },
    });
    if (requests.length === 0) return;

    const holidays = await this.prisma.publicHoliday.findMany({
      where: { country: 'CM' },
      select: { date: true, recurring: true },
    });
    const changes = requests
      .map((request) => {
        const isMaternity = request.leaveType.code.toUpperCase() === 'MAT';
        const nextEndDate = isMaternity
          ? endDateForWorkingDays(request.startDate, 90, holidays)
          : request.endDate;

        return {
          ...request,
          nextEndDate,
          nextDays: countWorkingDays(request.startDate, nextEndDate, holidays),
        };
      })
      .filter(
        (request) =>
          request.nextDays !== request.days ||
          request.nextEndDate.getTime() !== request.endDate.getTime(),
      );
    if (changes.length === 0) return;

    await this.prisma.$transaction(async (transaction) => {
      await Promise.all(
        changes.map((request) =>
          transaction.leaveRequest.update({
            where: { id: request.id },
            data: { days: request.nextDays, endDate: request.nextEndDate },
          }),
        ),
      );
      await this.leaveBalanceSync.syncForKeys(
        changes.map((request) => ({
          userId: request.ownerId,
          leaveTypeId: request.leaveTypeId,
          year: request.startDate.getUTCFullYear(),
        })),
        transaction,
      );
    });
  }
}
