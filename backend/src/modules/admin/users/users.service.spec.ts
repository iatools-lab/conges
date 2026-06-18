/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { RoleType, Sexe, UserStatus } from '@prisma/client';
import { AdminUsersService } from './users.service';

const employeeId = 'employee-1';

function role(role: RoleType) {
  return { id: `role-${role}`, userId: employeeId, role, scope: null };
}

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: employeeId,
    matricule: 'EMP001',
    nom: 'Employee',
    prenom: 'Test',
    sexe: Sexe.M,
    email: 'employee@upowa.org',
    telephone: null,
    poste: 'Analyste',
    status: UserStatus.ACTIVE,
    departmentId: null,
    n1Id: null,
    n2Id: null,
    n3Id: null,
    roles: [role(RoleType.EMPLOYE)],
    ...overrides,
  };
}

function managerRecord(id: string, roles = [role(RoleType.MANAGER)]) {
  return {
    ...userRecord({
      id,
      matricule: id,
      email: `${id}@upowa.org`,
      n1Id: null,
      n2Id: null,
      n3Id: null,
      roles,
    }),
  };
}

function summary(id: string) {
  return {
    id,
    nom: id,
    prenom: 'Manager',
    email: `${id}@upowa.org`,
  };
}

function createHarness(existing = userRecord()) {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  prisma.user.findUnique.mockImplementation(({ where, select }) => {
    if (select?.n1Id) return Promise.resolve({ n1Id: null });
    if (where.id === employeeId) return Promise.resolve(existing);
    if (where.id === 'non-manager') {
      return Promise.resolve(managerRecord('non-manager', [role(RoleType.EMPLOYE)]));
    }
    return Promise.resolve(managerRecord(where.id));
  });

  prisma.user.update.mockImplementation(({ data }) =>
    Promise.resolve({
      ...existing,
      ...(data.prenom ? { prenom: data.prenom } : {}),
      department: null,
      n1: data.n1?.connect ? summary(data.n1.connect.id) : null,
      n2: data.n2?.connect ? summary(data.n2.connect.id) : null,
      n3: data.n3?.connect ? summary(data.n3.connect.id) : null,
    }),
  );

  return {
    prisma,
    service: new AdminUsersService(prisma, {} as any),
  };
}

describe('AdminUsersService', () => {
  it('updates the explicit N+ hierarchy on the target employee', async () => {
    const { prisma, service } = createHarness();

    const result = await service.update(employeeId, {
      n1Id: 'manager-1',
      n2Id: 'manager-2',
      n3Id: 'manager-3',
    });

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: employeeId },
        data: expect.objectContaining({
          n1: { connect: { id: 'manager-1' } },
          n2: { connect: { id: 'manager-2' } },
          n3: { connect: { id: 'manager-3' } },
        }),
      }),
    );
    expect(result.manager).toEqual(summary('manager-1'));
    expect(result.n2Manager).toEqual(summary('manager-2'));
    expect(result.n3Manager).toEqual(summary('manager-3'));
  });

  it('keeps managerId as a backward-compatible alias for N+1', async () => {
    const { prisma, service } = createHarness();

    await service.update(employeeId, { managerId: 'manager-1' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          n1: { connect: { id: 'manager-1' } },
        }),
      }),
    );
    expect(prisma.user.update.mock.calls[0][0].data.n2).toBeUndefined();
    expect(prisma.user.update.mock.calls[0][0].data.n3).toBeUndefined();
  });

  it('rejects duplicate supervisors across N+1, N+2 and N+3', async () => {
    const { prisma, service } = createHarness();

    await expect(
      service.update(employeeId, {
        n1Id: 'manager-1',
        n2Id: 'manager-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not revalidate legacy N+2/N+3 data on unrelated updates', async () => {
    const { prisma, service } = createHarness(
      userRecord({ n2Id: 'non-manager' }),
    );

    await service.update(employeeId, { prenom: 'Patched' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ prenom: 'Patched' }),
      }),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
