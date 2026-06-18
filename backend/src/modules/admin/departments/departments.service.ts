import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import {
  findDirectorGeneralId,
  isDirectionGeneraleLabel,
} from '../../shared/hierarchy/default-manager';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class AdminDepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(q?: string) {
    const where: Prisma.DepartmentWhereInput = {};
    if (q) {
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.department.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { manager: true },
    });
    return { rows };
  }

  async findOne(id: string) {
    const dept = await this.prisma.department.findUnique({
      where: { id },
      include: { manager: true },
    });
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  async create(dto: CreateDepartmentDto) {
    const data: Prisma.DepartmentCreateInput = {
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
    };
    if (dto.managerId) data.manager = { connect: { id: dto.managerId } };

    const created = await this.prisma.$transaction(async (transaction) => {
      const department = await transaction.department.create({
        data,
        include: { manager: true },
      });

      await this.assignDirectorGeneralToDepartmentHead(
        transaction,
        dto.managerId,
        {
          code: dto.code,
          name: dto.name,
        },
      );

      return department;
    });
    return created;
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const exists = await this.prisma.department.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Department not found');

    const data: Prisma.DepartmentUpdateInput = {};
    if (dto.name) data.name = dto.name;
    if (dto.description) data.description = dto.description;
    if (dto.managerId) data.manager = { connect: { id: dto.managerId } };

    const updated = await this.prisma.$transaction(async (transaction) => {
      const department = await transaction.department.update({
        where: { id },
        data,
        include: { manager: true },
      });

      await this.assignDirectorGeneralToDepartmentHead(
        transaction,
        dto.managerId,
        {
          code: exists.code,
          name: dto.name ?? exists.name,
        },
      );

      return department;
    });
    return updated;
  }

  async remove(id: string) {
    const exists = await this.prisma.department.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Department not found');
    await this.prisma.department.delete({ where: { id } });
    return { deleted: true };
  }

  private async assignDirectorGeneralToDepartmentHead(
    client: TransactionClient,
    managerId: string | null | undefined,
    department: { code: string; name: string },
  ) {
    if (!managerId) return;
    if (
      isDirectionGeneraleLabel(department.name) ||
      isDirectionGeneraleLabel(department.code)
    ) {
      return;
    }

    const directorGeneralId = await findDirectorGeneralId(client);
    if (!directorGeneralId || directorGeneralId === managerId) return;

    await this.ensureNoManagerCycle(client, managerId, directorGeneralId);
    await client.user.update({
      where: { id: managerId },
      data: { n1: { connect: { id: directorGeneralId } } },
    });
  }

  private async ensureNoManagerCycle(
    client: TransactionClient,
    userId: string,
    managerId: string,
  ) {
    if (userId === managerId) {
      throw new BadRequestException(
        'Un utilisateur ne peut pas être son propre manager',
      );
    }

    let cursor: string | null = managerId;
    for (let depth = 0; depth < 10 && cursor; depth += 1) {
      if (cursor === userId) {
        throw new BadRequestException('Boucle hiérarchique détectée');
      }
      const current = (await client.user.findUnique({
        where: { id: cursor },
        select: { n1Id: true },
      })) as unknown;
      cursor = this.readN1Id(current);
    }
  }

  private readN1Id(record: unknown) {
    if (!record || typeof record !== 'object' || !('n1Id' in record)) {
      return null;
    }

    const n1Id = (record as { n1Id?: unknown }).n1Id;
    return typeof n1Id === 'string' ? n1Id : null;
  }
}
