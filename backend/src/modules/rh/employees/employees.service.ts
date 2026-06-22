import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleType, Sexe, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateRhEmployeeDto,
  ImportRhEmployeesDto,
  RhEmployeeRoleDto,
  RhEmployeeStatusDto,
  UpdateRhEmployeeDto,
} from './dto/rh-employee.dto';
import { findDirectorGeneralId } from '../../shared/hierarchy/default-manager';
import { MAX_PASSIVE_LEAVE_DAYS } from '../../shared/leave-entitlements/leave-entitlements.service';
import { LeaveBalanceInitializerService } from '../../shared/leave-balances/leave-balance-initializer.service';

const employeeSelect = {
  id: true,
  matricule: true,
  nom: true,
  prenom: true,
  dateNaissance: true,
  sexe: true,
  dateEmbauche: true,
  passifInitial: true,
  poste: true,
  email: true,
  status: true,
  department: {
    select: {
      name: true,
    },
  },
  n1: { select: { matricule: true } },
  n2: { select: { matricule: true } },
  n3: { select: { matricule: true } },
  roles: {
    select: {
      role: true,
    },
  },
} satisfies Prisma.UserSelect;

type EmployeeRecord = Prisma.UserGetPayload<{ select: typeof employeeSelect }>;

type RhEmployeeResponse = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: Sexe;
  embauche: string;
  passifInitial: number;
  dept: string;
  poste: string;
  email: string;
  n1Matricule?: string;
  n2Matricule?: string;
  n3Matricule?: string;
  role: RhEmployeeRoleDto;
  roles: RhEmployeeRoleDto[];
  status: RhEmployeeStatusDto;
};

type HierarchyMatricules = {
  n1Matricule?: string;
  n2Matricule?: string;
  n3Matricule?: string;
};

type ImportedEmployeeRecord = {
  employeeId: string;
  matricule: string;
  hierarchy: HierarchyMatricules;
};

type HierarchyConnections = {
  n1?: { connect: { id: string } };
  n2?: { connect: { id: string } };
  n3?: { connect: { id: string } };
};

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const TRANSACTION_TIMEOUT = 30_000; // 30 secondes pour les imports volumineux

@Injectable()
export class RhEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceInitializer: LeaveBalanceInitializerService,
  ) {}

  async findAll() {
    const employees = await this.prisma.user.findMany({
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      select: employeeSelect,
    });

    return employees.map((employee) => this.toResponse(employee));
  }

  async create(dto: CreateRhEmployeeDto) {
    try {
      return await this.createWithClient(this.prisma, dto);
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateRhEmployeeDto) {
    try {
      return await this.updateWithClient(this.prisma, id, dto);
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async importEmployees(dto: ImportRhEmployeesDto) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const records: ImportedEmployeeRecord[] = [];
          let created = 0;
          let updated = 0;

          for (const employeeDto of dto.employees) {
            const normalizedMatricule = employeeDto.matricule.trim();
            const normalizedEmail = employeeDto.email.trim().toLowerCase();

            const [existingByMatricule, existingByEmail] = await Promise.all([
              transaction.user.findUnique({
                where: { matricule: normalizedMatricule },
                select: { id: true },
              }),
              transaction.user.findUnique({
                where: { email: normalizedEmail },
                select: { id: true },
              }),
            ]);

            if (
              existingByMatricule &&
              existingByEmail &&
              existingByMatricule.id !== existingByEmail.id
            ) {
              throw new ConflictException(
                `Conflit d'import: matricule ${normalizedMatricule} et e-mail ${normalizedEmail} correspondent à deux employés différents`,
              );
            }

            const existing = existingByMatricule ?? existingByEmail;

            if (existing) {
              await this.updateWithClient(
                transaction,
                existing.id,
                employeeDto,
                false,
              );
              records.push({
                employeeId: existing.id,
                matricule: normalizedMatricule,
                hierarchy: this.extractHierarchyMatricules(employeeDto),
              });
              updated += 1;
            } else {
              const createdEmployee = await this.createWithClient(
                transaction,
                employeeDto,
                false,
              );
              records.push({
                employeeId: createdEmployee.id,
                matricule: normalizedMatricule,
                hierarchy: this.extractHierarchyMatricules(employeeDto),
              });
              created += 1;
            }
          }

          for (const record of records) {
            await this.applyHierarchyConnections(
              transaction,
              record.employeeId,
              record.hierarchy,
            );
          }

          const importedMatricules = records.map((record) => record.matricule);
          const employees = await transaction.user.findMany({
            where: { matricule: { in: importedMatricules } },
            orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
            select: employeeSelect,
          });

          return { created, updated, employees };
        },
        {
          timeout: TRANSACTION_TIMEOUT,
        },
      );
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async deactivate(id: string) {
    await this.ensureEmployeeExists(this.prisma, id);

    const employee = await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
      select: employeeSelect,
    });

    return this.toResponse(employee);
  }

  private async createWithClient(
    client: PrismaClientLike,
    dto: CreateRhEmployeeDto,
    resolveHierarchy = true,
  ) {
    const department = await this.ensureDepartment(client, dto.dept);
    const roles = this.toRoleTypes(
      dto.roles ?? (dto.role ? [dto.role] : undefined),
    );
    const hierarchyData = resolveHierarchy
      ? await this.buildHierarchyConnections(client, dto, roles, null)
      : {};
    const employee = await client.user.create({
      data: {
        matricule: dto.matricule.trim(),
        nom: dto.nom.trim().toUpperCase(),
        prenom: dto.prenom.trim(),
        dateNaissance: this.parseDate(dto.dateNaissance, 'dateNaissance'),
        sexe: dto.sexe,
        dateEmbauche: this.parseDate(dto.embauche, 'embauche'),
        passifInitial: this.normalizePassiveDays(dto.passifInitial),
        poste: dto.poste.trim(),
        email: dto.email.trim().toLowerCase(),
        status: UserStatus.ACTIVE,
        department: { connect: { id: department.id } },
        ...hierarchyData,
        roles: {
          create: roles.map((role) => ({ role })),
        },
      } satisfies Prisma.UserCreateInput,
      select: { id: true },
    });

    await this.leaveBalanceInitializer.initializeUserYear(
      employee.id,
      new Date().getUTCFullYear(),
      client,
    );

    const createdEmployee = await this.findEmployeeRecordById(
      client,
      employee.id,
    );
    return this.toResponse(createdEmployee);
  }

  private async updateWithClient(
    client: PrismaClientLike,
    id: string,
    dto: UpdateRhEmployeeDto,
    resolveHierarchy = true,
  ) {
    await this.ensureEmployeeExists(client, id);

    const data: Prisma.UserUpdateInput = {};
    let rolesForHierarchy: RoleType[] | undefined;

    if (dto.matricule !== undefined) data.matricule = dto.matricule.trim();
    if (dto.nom !== undefined) data.nom = dto.nom.trim().toUpperCase();
    if (dto.prenom !== undefined) data.prenom = dto.prenom.trim();
    if (dto.dateNaissance !== undefined) {
      data.dateNaissance = this.parseDate(dto.dateNaissance, 'dateNaissance');
    }
    if (dto.sexe !== undefined) data.sexe = dto.sexe;
    if (dto.embauche !== undefined)
      data.dateEmbauche = this.parseDate(dto.embauche, 'embauche');
    if (dto.passifInitial !== undefined) {
      data.passifInitial = this.normalizePassiveDays(dto.passifInitial);
    }
    if (dto.poste !== undefined) data.poste = dto.poste.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.status !== undefined) data.status = this.toUserStatus(dto.status);
    if (dto.dept !== undefined) {
      const department = await this.ensureDepartment(client, dto.dept);
      data.department = { connect: { id: department.id } };
    }
    if (dto.roles !== undefined || dto.role !== undefined) {
      const roles = this.toRoleTypes(
        dto.roles ?? (dto.role ? [dto.role] : undefined),
      );
      rolesForHierarchy = roles;
      data.roles = {
        deleteMany: {
          role: { in: [RoleType.EMPLOYE, RoleType.MANAGER, RoleType.RH] },
        },
        create: roles.map((role) => ({ role })),
      };
    }

    if (resolveHierarchy) {
      Object.assign(
        data,
        await this.buildHierarchyConnections(
          client,
          dto,
          rolesForHierarchy,
          id,
        ),
      );
    }

    await client.user.update({
      where: { id },
      data,
      select: { id: true },
    });

    await this.leaveBalanceInitializer.initializeUserYear(
      id,
      new Date().getUTCFullYear(),
      client,
    );

    const updatedEmployee = await this.findEmployeeRecordById(client, id);
    return this.toResponse(updatedEmployee);
  }

  private async findEmployeeRecordById(client: PrismaClientLike, id: string) {
    const employee = await client.user.findUnique({
      where: { id },
      select: employeeSelect,
    });

    if (!employee) {
      throw new NotFoundException('Employé introuvable');
    }

    return employee;
  }

  private async ensureEmployeeExists(client: PrismaClientLike, id: string) {
    const employee = await client.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employé introuvable');
  }

  private async ensureDepartment(client: PrismaClientLike, name: string) {
    const normalizedName = name.trim();
    if (!normalizedName) throw new BadRequestException('Le pôle est requis');

    const code = this.buildDepartmentCode(normalizedName);

    return client.department.upsert({
      where: { code },
      create: { code, name: normalizedName },
      update: { name: normalizedName },
      select: { id: true },
    });
  }

  private buildDepartmentCode(name: string) {
    const code = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);

    return code || 'POLE';
  }

  private parseDate(value: string, field: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Date invalide pour ${field}`);
    }

    return date;
  }

  private normalizePassiveDays(value: number | undefined) {
    const passiveDays = Number(value ?? 0);
    if (!Number.isFinite(passiveDays) || passiveDays < 0) {
      throw new BadRequestException('Passif initial invalide');
    }

    return Math.min(Math.round(passiveDays * 10) / 10, MAX_PASSIVE_LEAVE_DAYS);
  }

  private normalizeOptionalMatricule(value?: string) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private extractHierarchyMatricules(
    dto: Partial<HierarchyMatricules>,
  ): HierarchyMatricules {
    return {
      n1Matricule: this.normalizeOptionalMatricule(dto.n1Matricule),
      n2Matricule: this.normalizeOptionalMatricule(dto.n2Matricule),
      n3Matricule: this.normalizeOptionalMatricule(dto.n3Matricule),
    };
  }

  private async buildHierarchyConnections(
    client: PrismaClientLike,
    dto: Partial<HierarchyMatricules>,
    roles?: RoleType[],
    userId?: string | null,
  ): Promise<HierarchyConnections> {
    const hierarchy = this.extractHierarchyMatricules(dto);
    const data: HierarchyConnections = {};

    const n1Id = hierarchy.n1Matricule
      ? await this.resolveEmployeeIdByMatricule(
          client,
          hierarchy.n1Matricule,
          'N+1',
        )
      : null;
    const n2Id = hierarchy.n2Matricule
      ? await this.resolveEmployeeIdByMatricule(
          client,
          hierarchy.n2Matricule,
          'N+2',
        )
      : null;
    const n3Id = hierarchy.n3Matricule
      ? await this.resolveEmployeeIdByMatricule(
          client,
          hierarchy.n3Matricule,
          'N+3',
        )
      : null;

    const distinctIds = [n1Id, n2Id, n3Id].filter(Boolean) as string[];
    const uniqueIds = new Set(distinctIds);
    if (uniqueIds.size !== distinctIds.length) {
      throw new BadRequestException('N+1, N+2 et N+3 doivent être différents');
    }

    if (userId && uniqueIds.has(userId)) {
      throw new BadRequestException(
        'Un employé ne peut pas apparaître dans sa propre hiérarchie',
      );
    }

    if (n1Id) data.n1 = { connect: { id: n1Id } };
    if (n2Id) data.n2 = { connect: { id: n2Id } };
    if (n3Id) data.n3 = { connect: { id: n3Id } };

    const normalizedRoles = roles ?? [];
    if (!n1Id && normalizedRoles.includes(RoleType.RH)) {
      const directorGeneralId = await findDirectorGeneralId(
        client,
        userId ?? undefined,
      );
      if (directorGeneralId && directorGeneralId !== userId) {
        data.n1 = { connect: { id: directorGeneralId } };
      }
    }

    return data;
  }

  private async applyHierarchyConnections(
    client: PrismaClientLike,
    userId: string,
    hierarchy: HierarchyMatricules,
  ) {
    const employee = await client.user.findUnique({
      where: { id: userId },
      select: { roles: { select: { role: true } } },
    });
    const roles = employee?.roles.map((role) => role.role) ?? [];
    const data = await this.buildHierarchyConnections(
      client,
      hierarchy,
      roles,
      userId,
    );
    if (Object.keys(data).length === 0) return;

    await client.user.update({
      where: { id: userId },
      data,
      select: { id: true },
    });
  }

  private async resolveEmployeeIdByMatricule(
    client: PrismaClientLike,
    matricule: string,
    level: 'N+1' | 'N+2' | 'N+3',
  ) {
    const normalized = matricule.trim();
    if (!normalized) return null;

    const employee = await client.user.findUnique({
      where: { matricule: normalized },
      select: { id: true },
    });

    if (!employee) {
      throw new NotFoundException(
        `${level} introuvable pour le matricule ${normalized}`,
      );
    }

    return employee.id;
  }

  private toResponse(employee: EmployeeRecord): RhEmployeeResponse {
    return {
      id: employee.id,
      matricule: employee.matricule,
      nom: employee.nom,
      prenom: employee.prenom,
      dateNaissance: employee.dateNaissance?.toISOString().slice(0, 10) ?? '',
      sexe: employee.sexe,
      embauche: employee.dateEmbauche.toISOString().slice(0, 10),
      passifInitial: employee.passifInitial,
      dept: employee.department?.name ?? '',
      poste: employee.poste,
      email: employee.email,
      n1Matricule: employee.n1?.matricule,
      n2Matricule: employee.n2?.matricule,
      n3Matricule: employee.n3?.matricule,
      role: this.toRoleDto(employee.roles.map((role) => role.role)),
      roles: this.toRoleDtos(employee.roles.map((role) => role.role)),
      status: this.toStatusDto(employee.status),
    };
  }

  private toRoleTypes(roles: RhEmployeeRoleDto[] | undefined) {
    const selectedRoles = (roles ?? [RhEmployeeRoleDto.EMPLOYEE])
      .map((role) => this.toRoleType(role))
      .filter((role, index, list) => list.indexOf(role) === index);

    return selectedRoles.length > 0 ? selectedRoles : [RoleType.EMPLOYE];
  }

  private toRoleType(role: RhEmployeeRoleDto) {
    const roleMap: Record<RhEmployeeRoleDto, RoleType> = {
      [RhEmployeeRoleDto.EMPLOYEE]: RoleType.EMPLOYE,
      [RhEmployeeRoleDto.MANAGER]: RoleType.MANAGER,
      [RhEmployeeRoleDto.RH]: RoleType.RH,
    };

    return roleMap[role];
  }

  private toRoleDto(roles: RoleType[]) {
    if (roles.includes(RoleType.RH)) return RhEmployeeRoleDto.RH;
    if (roles.includes(RoleType.MANAGER)) return RhEmployeeRoleDto.MANAGER;
    return RhEmployeeRoleDto.EMPLOYEE;
  }

  private toRoleDtos(roles: RoleType[]) {
    return [
      { prisma: RoleType.EMPLOYE, dto: RhEmployeeRoleDto.EMPLOYEE },
      { prisma: RoleType.MANAGER, dto: RhEmployeeRoleDto.MANAGER },
      { prisma: RoleType.RH, dto: RhEmployeeRoleDto.RH },
    ]
      .filter((role) => roles.includes(role.prisma))
      .map((role) => role.dto);
  }

  private toUserStatus(status: RhEmployeeStatusDto) {
    const statusMap: Record<RhEmployeeStatusDto, UserStatus> = {
      [RhEmployeeStatusDto.ACTIVE]: UserStatus.ACTIVE,
      [RhEmployeeStatusDto.LEAVE]: UserStatus.ON_LEAVE,
      [RhEmployeeStatusDto.INACTIVE]: UserStatus.INACTIVE,
    };

    return statusMap[status];
  }

  private toStatusDto(status: UserStatus) {
    const statusMap: Record<UserStatus, RhEmployeeStatusDto> = {
      [UserStatus.ACTIVE]: RhEmployeeStatusDto.ACTIVE,
      [UserStatus.ON_LEAVE]: RhEmployeeStatusDto.LEAVE,
      [UserStatus.INACTIVE]: RhEmployeeStatusDto.INACTIVE,
    };

    return statusMap[status];
  }

  private handlePrismaError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Matricule ou e-mail déjà utilisé');
    }
  }
}
