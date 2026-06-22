import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { findDirectorGeneralId } from '../../shared/hierarchy/default-manager';
import { UpdateRhHierarchyDto } from './dto/rh-hierarchy.dto';

@Injectable()
export class RhHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async findUsers() {
    const rows = await this.prisma.user.findMany({
      where: { status: { not: UserStatus.INACTIVE } },
      take: 500,
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        poste: true,
        departmentId: true,
        n1Id: true,
        n2Id: true,
        n3Id: true,
        department: { select: { id: true, name: true } },
        roles: { select: { role: true } },
      },
    });

    return { rows };
  }

  async findDepartments() {
    const rows = await this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        managerId: true,
        manager: {
          select: { id: true, nom: true, prenom: true, email: true },
        },
      },
    });

    return { rows };
  }

  async updateUserHierarchy(id: string, dto: UpdateRhHierarchyDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Employé introuvable');

    const supervisorIds = [dto.n1Id, dto.n2Id, dto.n3Id].filter(
      (value): value is string => Boolean(value),
    );
    if (supervisorIds.includes(id)) {
      throw new BadRequestException(
        'Un employé ne peut pas apparaître dans sa propre hiérarchie',
      );
    }
    if (new Set(supervisorIds).size !== supervisorIds.length) {
      throw new BadRequestException(
        'N+1, N+2 et N+3 doivent être des personnes différentes',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await this.ensureManagers(transaction, supervisorIds);
      await transaction.user.update({
        where: { id },
        data: {
          ...(dto.n1Id !== undefined
            ? {
                n1: dto.n1Id
                  ? { connect: { id: dto.n1Id } }
                  : { disconnect: true },
              }
            : {}),
          ...(dto.n2Id !== undefined
            ? {
                n2: dto.n2Id
                  ? { connect: { id: dto.n2Id } }
                  : { disconnect: true },
              }
            : {}),
          ...(dto.n3Id !== undefined
            ? {
                n3: dto.n3Id
                  ? { connect: { id: dto.n3Id } }
                  : { disconnect: true },
              }
            : {}),
        },
      });
    });

    return { id, updated: true };
  }

  async updateDepartmentHead(departmentId: string, managerId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const department = await transaction.department.findUnique({
        where: { id: departmentId },
        select: { id: true, code: true, name: true },
      });
      if (!department) throw new NotFoundException('Département introuvable');

      await this.ensureManagers(transaction, [managerId]);
      const updated = await transaction.department.update({
        where: { id: departmentId },
        data: { manager: { connect: { id: managerId } } },
        select: { id: true, name: true, managerId: true },
      });

      const directorGeneralId = await findDirectorGeneralId(
        transaction,
        managerId,
      );
      if (directorGeneralId && directorGeneralId !== managerId) {
        await transaction.user.update({
          where: { id: managerId },
          data: { n1: { connect: { id: directorGeneralId } } },
        });
      }

      return updated;
    });
  }

  private async ensureManagers(
    transaction: Prisma.TransactionClient,
    userIds: string[],
  ) {
    if (userIds.length === 0) return;
    const uniqueIds = [...new Set(userIds)];
    const users = await transaction.user.findMany({
      where: {
        id: { in: uniqueIds },
        status: { not: UserStatus.INACTIVE },
      },
      select: { id: true, roles: { select: { role: true } } },
    });
    if (users.length !== uniqueIds.length) {
      throw new NotFoundException('Un responsable sélectionné est introuvable');
    }

    for (const user of users) {
      if (!user.roles.some((role) => role.role === RoleType.MANAGER)) {
        await transaction.userRole.create({
          data: { userId: user.id, role: RoleType.MANAGER },
        });
      }
    }
  }
}
