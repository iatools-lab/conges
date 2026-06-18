import { Prisma, RoleType, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

function normalizeHierarchyLabel(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function isDirectionGeneraleLabel(value: string | null | undefined) {
  const normalized = normalizeHierarchyLabel(value);

  return normalized.includes('direction') && normalized.includes('general');
}

function isDirectorGeneralPoste(value: string | null | undefined) {
  return normalizeHierarchyLabel(value).includes('directeurgeneral');
}

function hasManagerRole(user: { roles: Array<{ role: RoleType }> }) {
  return user.roles.some((role) => role.role === RoleType.MANAGER);
}

export async function findDirectorGeneralId(
  client: PrismaClientLike,
  excludeUserId?: string | null,
) {
  const departments = await client.department.findMany({
    select: {
      id: true,
      code: true,
      name: true,
      manager: {
        select: {
          id: true,
          roles: { select: { role: true } },
        },
      },
    },
  });
  const directionDepartment = departments.find(
    (department) =>
      isDirectionGeneraleLabel(department.name) ||
      isDirectionGeneraleLabel(department.code),
  );
  const departmentManager = directionDepartment?.manager;

  if (departmentManager?.id === excludeUserId) return null;

  if (
    departmentManager &&
    departmentManager.id !== excludeUserId &&
    hasManagerRole(departmentManager)
  ) {
    return departmentManager.id;
  }

  const candidates = await client.user.findMany({
    where: {
      id: excludeUserId ? { not: excludeUserId } : undefined,
      status: { not: UserStatus.INACTIVE },
      OR: [
        { poste: { contains: 'directeur', mode: 'insensitive' } },
        ...(directionDepartment
          ? [{ departmentId: directionDepartment.id }]
          : []),
      ],
    },
    select: {
      id: true,
      poste: true,
      departmentId: true,
      roles: { select: { role: true } },
    },
  });
  const byPoste = candidates.find(
    (user) => isDirectorGeneralPoste(user.poste) && hasManagerRole(user),
  );
  if (byPoste) return byPoste.id;

  const byDirectionDepartment = candidates.find(
    (user) =>
      user.departmentId === directionDepartment?.id && hasManagerRole(user),
  );

  return byDirectionDepartment?.id ?? null;
}
