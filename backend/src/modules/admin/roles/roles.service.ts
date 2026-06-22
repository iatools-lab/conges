import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(userId?: string) {
    const where: Prisma.UserRoleWhereInput = {};
    if (userId) where.userId = userId;
    const rows = await this.prisma.userRole.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { rows };
  }

  async create(dto: CreateRoleDto) {
    const created = await this.prisma.userRole.create({
      data: { userId: dto.userId, role: dto.role, scope: dto.scope ?? null },
    });
    return created;
  }

  async update(id: string, dto: UpdateRoleDto) {
    const exists = await this.prisma.userRole.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Role not found');
    const updated = await this.prisma.userRole.update({
      where: { id },
      data: { scope: dto.scope ?? null },
    });
    return updated;
  }

  async remove(id: string) {
    const exists = await this.prisma.userRole.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Role not found');
    await this.prisma.userRole.delete({ where: { id } });
    return { deleted: true };
  }
}
