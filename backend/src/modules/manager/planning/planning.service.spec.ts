import { LeaveCategory, RoleType, UserStatus } from '@prisma/client';
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
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
  const leaveBalanceInitializer = {
    initializeUserYear: jest.fn().mockResolvedValue({}),
  } as any;
  const leaveBalanceSync = {
    syncForKeys: jest.fn().mockResolvedValue({}),
  } as any;

  return {
    prisma,
    leaveBalanceInitializer,
    leaveBalanceSync,
    service: new ManagerPlanningService(
      prisma,
      leaveBalanceInitializer,
      leaveBalanceSync,
    ),
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

  it('applies the selected department filter on the backend scope', async () => {
    const { prisma, service } = createHarness(departmentHead);

    await service.findYear({
      managerId: departmentHead.id,
      year: 2026,
      department: 'FIN',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { departmentId: { in: ['dept-1'] } },
              ]),
            }),
            { department: { code: 'FIN' } },
          ],
        },
      }),
    );
  });

  it('computes balance rows from the paid leave pool without mixing other leave types', async () => {
    const { prisma, leaveBalanceInitializer, service } =
      createHarness(departmentHead);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'employee-1',
        matricule: 'EMP001',
        nom: 'Employee',
        prenom: 'Test',
        poste: 'Agent',
        department: { id: 'dept-1', code: 'OPS', name: 'Ops' },
        leaveRequests: [],
      },
    ]);
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        userId: 'employee-1',
        acquired: 10,
        carryover: 0,
        taken: 2,
        scheduled: 1,
        leaveType: { code: 'CP', category: LeaveCategory.CONGE_PAYE },
      },
      {
        userId: 'employee-1',
        acquired: 5,
        carryover: 0,
        taken: 1,
        scheduled: 0,
        leaveType: { code: 'PASSIF', category: LeaveCategory.CONGE_PAYE },
      },
      {
        userId: 'employee-1',
        acquired: 90,
        carryover: 0,
        taken: 0,
        scheduled: 0,
        leaveType: { code: 'MAT', category: LeaveCategory.CONGE_MATERNITE },
      },
    ]);

    const result = await service.findYear({
      managerId: departmentHead.id,
      year: 2026,
    });

    expect(leaveBalanceInitializer.initializeUserYear).toHaveBeenCalledWith(
      'employee-1',
      2026,
    );
    expect(result.rows[0]).toMatchObject({
      total: 15,
      taken: 3,
      planned: 1,
      remaining: 11,
      passif: 4,
    });
  });
});
