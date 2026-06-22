import { RoleType, UserStatus } from '@prisma/client';
import { ManagerPlanningService } from './planning.service';

const departmentHead = {
  id: 'manager-1',
  email: 'manager@upowa.org',
  nom: 'Manager',
  prenom: 'Test',
  status: UserStatus.ACTIVE,
  department: { id: 'dept-1', code: 'OPS', name: 'Ops' },
  managedDepartments: [{ id: 'dept-1', code: 'OPS', name: 'Ops' }],
  roles: [{ role: RoleType.MANAGER, scope: null }],
};

const nPlusManager = {
  ...departmentHead,
  managedDepartments: [],
};

function createHarness(manager = departmentHead) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(manager),
      findMany: jest.fn().mockResolvedValue([]),
    },
    leaveBalance: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;

  return {
    prisma,
    service: new ManagerPlanningService(prisma),
  };
}

describe('ManagerPlanningService', () => {
  it('scopes non-department-head managers to their N+ employees only', async () => {
    const { prisma, service } = createHarness(nPlusManager);

    await service.findYear({ managerId: nPlusManager.id, year: 2026 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { departmentId: { in: [] } },
            { n1Id: nPlusManager.id },
            { n2Id: nPlusManager.id },
            { n3Id: nPlusManager.id },
          ]),
        }),
      }),
    );
  });

  it('uses managed departments for department-head full team visibility', async () => {
    const { prisma, service } = createHarness(departmentHead);

    await service.findYear({ managerId: departmentHead.id, year: 2026 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { departmentId: { in: ['dept-1'] } },
            { n1Id: departmentHead.id },
            { n2Id: departmentHead.id },
            { n3Id: departmentHead.id },
          ]),
        }),
      }),
    );
  });
});
