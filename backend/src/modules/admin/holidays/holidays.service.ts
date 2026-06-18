import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';

@Injectable()
export class AdminHolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(year?: number, country?: string) {
    const where: any = {};
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

  async create(dto: CreateHolidayDto) {
    const date = new Date(dto.date);
    const created = await this.prisma.publicHoliday.create({
      data: {
        date,
        name: dto.name,
        country: dto.country ?? 'CM',
        recurring: dto.recurring ?? false,
      },
    });

    return created;
  }

  async update(id: string, dto: UpdateHolidayDto) {
    const exists = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('Holiday not found');

    const data: any = {};
    if (dto.date) data.date = new Date(dto.date);
    if (dto.name) data.name = dto.name;
    if (dto.country) data.country = dto.country;
    if (typeof dto.recurring !== 'undefined') data.recurring = dto.recurring;

    const updated = await this.prisma.publicHoliday.update({
      where: { id },
      data,
    });
    return updated;
  }

  async remove(id: string) {
    const exists = await this.prisma.publicHoliday.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('Holiday not found');

    await this.prisma.publicHoliday.delete({ where: { id } });
    return { deleted: true };
  }
}
