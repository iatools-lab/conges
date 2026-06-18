import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpsertSettingDto } from './dto/upsert-setting.dto';

@Injectable()
export class AdminSettingsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.systemSetting.findMany();
  }

  findOne(id: string) {
    return this.prisma.systemSetting.findUnique({ where: { id } });
  }

  async upsert(dto: UpsertSettingDto) {
    const existing = await this.prisma.systemSetting.findFirst({
      where: { key: dto.key },
    });
    if (existing) {
      return this.prisma.systemSetting.update({
        where: { id: existing.id },
        data: dto,
      });
    }
    return this.prisma.systemSetting.create({ data: dto as any });
  }

  remove(id: string) {
    return this.prisma.systemSetting.delete({ where: { id } });
  }
}
