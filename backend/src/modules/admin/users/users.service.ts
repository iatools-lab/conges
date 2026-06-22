import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma, RoleType } from '@prisma/client';
import { RhEmployeesService } from '../../rh/employees/employees.service';
import { ImportRhEmployeesDto } from '../../rh/employees/dto/rh-employee.dto';
import { findDirectorGeneralId } from '../../shared/hierarchy/default-manager';

const BUSINESS_ROLES: RoleType[] = [
  RoleType.EMPLOYE,
  RoleType.MANAGER,
  RoleType.RH,
];

type BusinessRoleCreate = { role: RoleType; scope?: string };

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rhEmployeesService: RhEmployeesService,
  ) {}

  async findMany(q?: string, limit = 50) {
    const where: Prisma.UserWhereInput = {};
    if (q) {
      where.OR = [
        { nom: { contains: q, mode: 'insensitive' } },
        { prenom: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { matricule: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      take: limit,
      orderBy: { nom: 'asc' },
      include: {
        roles: true,
        department: true,
        n1: {
          select: { id: true, nom: true, prenom: true, email: true },
        },
        n2: {
          select: { id: true, nom: true, prenom: true, email: true },
        },
        n3: {
          select: { id: true, nom: true, prenom: true, email: true },
        },
      },
    });

    return {
      rows: rows.map((row) => ({
        ...row,
        manager: row.n1,
        n2Manager: row.n2,
        n3Manager: row.n3,
      })),
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: true,
        department: true,
        n1: { select: { id: true, nom: true, prenom: true, email: true } },
        n2: { select: { id: true, nom: true, prenom: true, email: true } },
        n3: { select: { id: true, nom: true, prenom: true, email: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      ...user,
      manager: user.n1,
      n2Manager: user.n2,
      n3Manager: user.n3,
    };
  }

  async create(dto: CreateUserDto) {
    const roleCreates = this.toRoleCreates(dto.roles);
    const managerId = await this.resolveDefaultManagerId(
      null,
      dto.managerId ?? null,
      roleCreates.map((role) => role.role),
    );
    await this.validateManagerAssignment(null, managerId);

    const data: Prisma.UserCreateInput = {
      matricule: dto.matricule,
      nom: dto.nom,
      prenom: dto.prenom,
      sexe: dto.sexe,
      email: dto.email.toLowerCase(),
      telephone: dto.telephone ?? null,
      poste: dto.poste,
      dateEmbauche: new Date(),
      roles: { create: roleCreates },
    };

    if (dto.departmentId)
      data.department = { connect: { id: dto.departmentId } };
    if (managerId) data.n1 = { connect: { id: managerId } };

    const user = await this.prisma.user.create({
      data,
      include: {
        roles: true,
        department: true,
        n1: { select: { id: true, nom: true, prenom: true, email: true } },
      },
    });
    return { ...user, manager: user.n1 };
  }

  async update(id: string, dto: UpdateUserDto) {
    const exists = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!exists) throw new NotFoundException('User not found');

    const roleCreates =
      dto.roles !== undefined ? this.toRoleCreates(dto.roles, false) : null;
    const roleTypes = roleCreates
      ? roleCreates.map((role) => role.role)
      : exists.roles.map((role) => role.role);
    const hasN1Update = 'n1Id' in dto || 'managerId' in dto;
    const hasN2Update = 'n2Id' in dto;
    const hasN3Update = 'n3Id' in dto;
    const requestedManagerId =
      'n1Id' in dto
        ? (dto.n1Id ?? null)
        : 'managerId' in dto
          ? (dto.managerId ?? null)
          : exists.n1Id;
    const managerId = await this.resolveDefaultManagerId(
      id,
      requestedManagerId,
      roleTypes,
    );
    const n2Id = hasN2Update ? (dto.n2Id ?? null) : exists.n2Id;
    const n3Id = hasN3Update ? (dto.n3Id ?? null) : exists.n3Id;
    const hasHierarchyUpdate =
      hasN1Update || hasN2Update || hasN3Update || managerId !== exists.n1Id;
    if (hasHierarchyUpdate) {
      await this.validateHierarchyAssignment(id, {
        n1Id: managerId,
        n2Id,
        n3Id,
      });
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.nom) data.nom = dto.nom;
    if (dto.prenom) data.prenom = dto.prenom;
    if (dto.email) data.email = dto.email.toLowerCase();
    if (dto.telephone) data.telephone = dto.telephone;
    if (dto.poste) data.poste = dto.poste;
    if (dto.departmentId)
      data.department = { connect: { id: dto.departmentId } };
    if (hasN1Update || managerId !== exists.n1Id) {
      data.n1 = managerId
        ? { connect: { id: managerId } }
        : { disconnect: true };
    }
    if (hasN2Update) {
      data.n2 = n2Id ? { connect: { id: n2Id } } : { disconnect: true };
    }
    if (hasN3Update) {
      data.n3 = n3Id ? { connect: { id: n3Id } } : { disconnect: true };
    }
    if (dto.roles !== undefined) {
      data.roles = {
        deleteMany: { role: { in: BUSINESS_ROLES } },
        create: roleCreates ?? [],
      };
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: {
        roles: true,
        department: true,
        n1: { select: { id: true, nom: true, prenom: true, email: true } },
        n2: { select: { id: true, nom: true, prenom: true, email: true } },
        n3: { select: { id: true, nom: true, prenom: true, email: true } },
      },
    });
    return {
      ...updated,
      manager: updated.n1,
      n2Manager: updated.n2,
      n3Manager: updated.n3,
    };
  }

  importEmployees(dto: ImportRhEmployeesDto) {
    return this.rhEmployeesService.importEmployees(dto);
  }

  async remove(id: string) {
    const exists = await this.prisma.user.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('User not found');

    await this.prisma.user.delete({ where: { id } });
    return { deleted: true };
  }

  private async validateManagerAssignment(
    userId: string | null,
    managerId: string | null | undefined,
  ) {
    const targetManagerId = managerId?.trim();
    if (!targetManagerId) return;

    if (userId && targetManagerId === userId) {
      throw new BadRequestException(
        'Un utilisateur ne peut pas être son propre manager',
      );
    }

    const manager = await this.prisma.user.findUnique({
      where: { id: targetManagerId },
      include: { roles: true },
    });
    if (!manager) throw new NotFoundException('Manager introuvable');

    const canManage = manager.roles.some(
      (role) => role.role === RoleType.MANAGER,
    );
    if (!canManage) {
      throw new BadRequestException(
        'Le manager sélectionné doit avoir le rôle MANAGER',
      );
    }

    if (!userId) return;

    let cursor: string | null = targetManagerId;
    for (let depth = 0; depth < 10 && cursor; depth += 1) {
      if (cursor === userId) {
        throw new BadRequestException('Boucle hiérarchique détectée');
      }
      const current = (await this.prisma.user.findUnique({
        where: { id: cursor },
        select: { n1Id: true },
      })) as unknown;
      cursor = this.readN1Id(current);
    }
  }

  private async validateHierarchyAssignment(
    userId: string,
    hierarchy: {
      n1Id: string | null | undefined;
      n2Id: string | null | undefined;
      n3Id: string | null | undefined;
    },
  ) {
    const supervisorIds = [
      hierarchy.n1Id?.trim() || null,
      hierarchy.n2Id?.trim() || null,
      hierarchy.n3Id?.trim() || null,
    ].filter((supervisorId): supervisorId is string => Boolean(supervisorId));

    if (supervisorIds.includes(userId)) {
      throw new BadRequestException(
        'Un utilisateur ne peut pas apparaÃ®tre dans sa propre hiérarchie',
      );
    }

    if (new Set(supervisorIds).size !== supervisorIds.length) {
      throw new BadRequestException('N+1, N+2 et N+3 doivent Ãªtre différents');
    }

    await this.validateManagerAssignment(userId, hierarchy.n1Id);
    await Promise.all([
      this.validateManagerRole(hierarchy.n2Id, 'N+2'),
      this.validateManagerRole(hierarchy.n3Id, 'N+3'),
    ]);
  }

  private async validateManagerRole(
    managerId: string | null | undefined,
    level = 'Manager',
  ) {
    const targetManagerId = managerId?.trim();
    if (!targetManagerId) return;

    const manager = await this.prisma.user.findUnique({
      where: { id: targetManagerId },
      include: { roles: true },
    });
    if (!manager) throw new NotFoundException(`${level} introuvable`);

    const canManage = manager.roles.some(
      (role) => role.role === RoleType.MANAGER,
    );
    if (!canManage) {
      throw new BadRequestException(`${level} doit avoir le rÃ´le MANAGER`);
    }
  }

  private readN1Id(record: unknown) {
    if (!record || typeof record !== 'object' || !('n1Id' in record)) {
      return null;
    }

    const n1Id = (record as { n1Id?: unknown }).n1Id;
    return typeof n1Id === 'string' ? n1Id : null;
  }

  private toRoleCreates(
    roles: Array<{ role: RoleType; scope?: string }> | undefined,
    withDefault = true,
  ): BusinessRoleCreate[] {
    const selectedRoles = (roles ?? [])
      .filter((role) => BUSINESS_ROLES.includes(role.role))
      .map((role) => ({ role: role.role, scope: role.scope }));

    if (selectedRoles.length > 0 || !withDefault) return selectedRoles;

    return [{ role: RoleType.EMPLOYE }];
  }

  private async resolveDefaultManagerId(
    userId: string | null,
    requestedManagerId: string | null | undefined,
    roles: RoleType[],
  ) {
    if (!roles.includes(RoleType.RH)) {
      return requestedManagerId?.trim() || null;
    }

    const directorGeneralId = await findDirectorGeneralId(this.prisma, userId);
    return directorGeneralId ?? requestedManagerId?.trim() ?? null;
  }
}
