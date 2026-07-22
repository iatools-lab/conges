import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  LeaveCategory,
  LeaveRequestStatus,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { ManagerRequestsService } from './requests.service';

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

const manager = departmentHead;

const nPlusManager = {
  ...departmentHead,
  managedDepartments: [],
};

function managerRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    reference: 'DM-2026-001',
    ownerId: 'employee-1',
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    days: 3,
    reason: 'Repos',
    status: LeaveRequestStatus.PENDING,
    submittedAt: new Date('2026-05-29T09:00:00.000Z'),
    decidedAt: null,
    leaveTypeId: 'type-1',
    owner: {
      id: 'employee-1',
      matricule: 'EMP001',
      email: 'employee@upowa.org',
      nom: 'Employee',
      prenom: 'Test',
      poste: 'Agent',
      n1Id: 'manager-1',
      n2Id: 'manager-2',
      n3Id: 'manager-3',
      department: { id: 'dept-1', code: 'OPS', name: 'Ops' },
    },
    leaveType: {
      id: 'type-1',
      code: 'CP',
      name: 'Congé payé',
      category: LeaveCategory.CONGE_PAYE,
    },
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    leaveBalance: {
      findMany: jest.fn(),
    },
    validation: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  } as any;

  const emailService = {
    send: jest.fn(),
    sendMany: jest.fn(),
  } as any;

  const leaveBalanceSync = {
    syncForRequest: jest.fn(),
    syncForKeys: jest.fn(),
  } as any;

  prisma.user.findUnique.mockResolvedValue(manager);
  prisma.user.findMany.mockResolvedValue([
    { id: 'rh-1', email: 'rh@upowa.org' },
  ]);
  prisma.leaveBalance.findMany.mockResolvedValue([
    {
      userId: 'employee-1',
      leaveTypeId: 'type-1',
      year: 2026,
      acquired: 20,
      carryover: 0,
      taken: 4,
      scheduled: 3,
      leaveType: { code: 'CP', category: LeaveCategory.CONGE_PAYE },
    },
  ]);
  prisma.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
  prisma.leaveRequest.findUniqueOrThrow.mockResolvedValue(
    managerRequest({ status: LeaveRequestStatus.IN_REVIEW }),
  );
  prisma.validation.findFirst.mockResolvedValue(null);

  return {
    prisma,
    emailService,
    leaveBalanceSync,
    service: new ManagerRequestsService(prisma, emailService, leaveBalanceSync),
  };
}

describe('ManagerRequestsService', () => {
  it('lists N+2/N+3 visible requests without decision rights and excludes unsubmitted drafts', async () => {
    const { prisma, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue(nPlusManager);
    prisma.leaveRequest.findMany.mockResolvedValue([
      managerRequest({
        owner: {
          ...managerRequest().owner,
          n1Id: 'other-manager',
          n2Id: manager.id,
        },
      }),
    ]);

    const result = await service.findAll({ managerId: manager.id, year: 2026 });

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          owner: expect.objectContaining({
            OR: expect.arrayContaining([
              { n1Id: manager.id },
              { n2Id: manager.id },
              { n3Id: manager.id },
              { departmentId: { in: [] } },
            ]),
          }),
          OR: [
            { status: { not: LeaveRequestStatus.DRAFT } },
            { submittedAt: { not: null } },
          ],
        }),
      }),
    );
    expect(result.rows[0].canDecide).toBe(false);
  });

  it('lets department heads see their whole department but not decide outside direct N+1 scope', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findMany.mockResolvedValue([
      managerRequest({
        owner: {
          ...managerRequest().owner,
          n1Id: 'other-manager',
          n2Id: 'other-n2',
          n3Id: 'other-n3',
        },
      }),
    ]);

    const result = await service.findAll({ managerId: manager.id, year: 2026 });

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          owner: expect.objectContaining({
            OR: expect.arrayContaining([{ departmentId: { in: ['dept-1'] } }]),
          }),
        }),
      }),
    );
    expect(result.rows[0].canDecide).toBe(false);
  });

  it('shows the paid leave pool balance in manager request rows', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
    prisma.leaveRequest.findMany.mockResolvedValue([managerRequest()]);
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        userId: 'employee-1',
        leaveTypeId: 'type-1',
        year: 2026,
        acquired: 20,
        carryover: 0,
        taken: 4,
        scheduled: 3,
        leaveType: { code: 'CP', category: LeaveCategory.CONGE_PAYE },
      },
      {
        userId: 'employee-1',
        leaveTypeId: 'passif-type',
        year: 2026,
        acquired: 5,
        carryover: 0,
        taken: 0,
        scheduled: 0,
        leaveType: { code: 'PASSIF', category: LeaveCategory.CONGE_PAYE },
      },
      {
        userId: 'employee-1',
        leaveTypeId: 'mat-type',
        year: 2026,
        acquired: 90,
        carryover: 0,
        taken: 0,
        scheduled: 0,
        leaveType: { code: 'MAT', category: LeaveCategory.CONGE_MATERNITE },
      },
    ]);

    const result = await service.findAll({ managerId: manager.id, year: 2026 });

    expect(leaveBalanceSync.syncForKeys).toHaveBeenCalledWith([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);
    expect(result.rows[0].solde).toBe(18);
  });

  it('rejects manager decisions outside direct N+1 scope', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue(
      managerRequest({
        owner: {
          ...managerRequest().owner,
          n1Id: 'other-manager',
          n2Id: manager.id,
        },
      }),
    );

    await expect(
      service.decide('request-1', {
        managerId: manager.id,
        decision: 'approve',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason for review and reject decisions', async () => {
    const { service } = createHarness();

    await expect(
      service.decide('request-1', {
        managerId: manager.id,
        decision: 'review',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.decide('request-1', {
        managerId: manager.id,
        decision: 'reject',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves a direct N+1 pending request into RH review', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue(managerRequest());

    const result = await service.decide('request-1', {
      managerId: manager.id,
      decision: 'approve',
    });

    expect(prisma.validation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decision: ValidationDecision.APPROVED,
        level: 1,
      }),
    });
    expect(prisma.leaveRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveRequestStatus.IN_REVIEW,
          decidedAt: null,
        }),
      }),
    );
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );
    expect(emailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'employee@upowa.org' }),
    );
    expect(emailService.sendMany).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'rh@upowa.org' }),
    ]);
    expect(result.statusLabel).toBe('En attente validation RH');
  });
});
