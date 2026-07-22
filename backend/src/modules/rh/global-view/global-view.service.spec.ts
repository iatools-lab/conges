import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AuditAction,
  LeaveCategory,
  LeaveRequestStatus,
  NotificationType,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { RhGlobalViewService } from './global-view.service';

const rhUser = {
  id: 'rh-1',
  email: 'rh@upowa.org',
  nom: 'RH',
  prenom: 'Test',
  status: UserStatus.ACTIVE,
  roles: [{ role: RoleType.RH }],
};

const request = {
  id: 'request-1',
  reference: 'DM-2026-001',
  status: LeaveRequestStatus.IN_REVIEW,
  ownerId: 'employee-1',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  endDate: new Date('2026-06-03T00:00:00.000Z'),
  leaveTypeId: 'type-1',
  owner: {
    id: 'employee-1',
    nom: 'Employee',
    prenom: 'Test',
    n1Id: 'manager-1',
  },
};

function createHarness() {
  const prisma = {
    department: {
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    validation: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    publicHoliday: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: jest.fn(),
    },
    leaveBalance: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  } as any;

  const emailService = {
    sendMany: jest.fn(),
  } as any;

  const configService = {
    get: jest.fn().mockReturnValue('7'),
  } as any;

  const leaveBalanceSync = {
    syncForRequest: jest.fn(),
    syncForKeys: jest.fn(),
    syncYear: jest.fn(),
    syncUserYear: jest.fn(),
  } as any;
  const leaveBalanceInitializer = {
    initializeUserYear: jest.fn(),
    refreshPaidDebtCarryover: jest.fn(),
  } as any;

  prisma.user.findFirst.mockResolvedValue(rhUser);
  prisma.user.findUnique.mockResolvedValue(rhUser);
  prisma.user.findMany.mockResolvedValue([
    { email: 'employee@upowa.org' },
    { email: 'manager@upowa.org' },
  ]);
  prisma.leaveRequest.findMany.mockResolvedValue([]);
  prisma.leaveRequest.findUnique.mockResolvedValue(request);
  prisma.leaveRequest.updateMany.mockResolvedValue({ count: 1 });
  prisma.validation.findFirst.mockResolvedValue(null);
  prisma.leaveRequest.create.mockImplementation(({ data }) =>
    Promise.resolve({
      id: 'imported-request-1',
      reference: data.reference,
      startDate: data.startDate,
      endDate: data.endDate,
      days: data.days,
      status: data.status,
      ownerId: data.ownerId,
      leaveTypeId: data.leaveTypeId,
      owner: {
        matricule: 'EMP001',
        nom: 'Employee',
        prenom: 'Test',
      },
      leaveType: {
        code: 'CP',
        name: 'Conges payes',
      },
    }),
  );
  prisma.department.findMany.mockResolvedValue([]);
  prisma.leaveType = {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'type-cp',
        code: 'CP',
        name: 'Conges payes',
        category: 'CONGE_PAYE',
      },
      {
        id: 'type-spe',
        code: 'SPE',
        name: 'Conge special',
        category: 'CONGE_SPECIAL',
      },
    ]),
  };

  return {
    prisma,
    emailService,
    configService,
    leaveBalanceSync,
    leaveBalanceInitializer,
    service: new RhGlobalViewService(
      prisma,
      emailService,
      configService,
      leaveBalanceSync,
      leaveBalanceInitializer,
    ),
  };
}

describe('RhGlobalViewService', () => {
  it('persists an RH correction to paid leave days taken', async () => {
    const { prisma, leaveBalanceSync, leaveBalanceInitializer, service } =
      createHarness();
    prisma.user.findUnique.mockResolvedValueOnce(rhUser).mockResolvedValueOnce({
      id: 'employee-1',
      matricule: 'EMP001',
      nom: 'Employee',
      prenom: 'Test',
    });
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        id: 'balance-cp',
        taken: 30,
        takenAdjustment: 0,
        leaveType: { code: 'CP' },
      },
    ]);

    const result = await service.updateTakenDays('employee-1', {
      rhId: rhUser.id,
      year: 2026,
      taken: 20,
      comment: 'Régularisation RH',
    });

    expect(leaveBalanceInitializer.initializeUserYear).toHaveBeenCalledWith(
      'employee-1',
      2026,
      prisma,
    );
    expect(leaveBalanceSync.syncUserYear).toHaveBeenCalledWith(
      'employee-1',
      2026,
      prisma,
    );
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-cp' },
      data: { taken: 20, takenAdjustment: -10 },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: rhUser.id,
          entity: 'LeaveBalance',
          entityId: 'employee-1',
          metadata: expect.objectContaining({
            previousTaken: 30,
            newTaken: 20,
            adjustmentDelta: -10,
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ previousTaken: 30, taken: 20 }),
    );
  });

  it('persists an RH correction to the total paid leave balance', async () => {
    const { prisma, leaveBalanceSync, leaveBalanceInitializer, service } =
      createHarness();
    prisma.user.findUnique.mockResolvedValueOnce(rhUser).mockResolvedValueOnce({
      id: 'employee-1',
      matricule: 'EMP001',
      nom: 'Employee',
      prenom: 'Test',
    });
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        id: 'balance-cp',
        acquired: 24,
        carryover: 0,
        balanceAdjustment: 0,
        leaveType: { code: 'CP' },
      },
      {
        id: 'balance-passif',
        acquired: 4,
        carryover: 0,
        balanceAdjustment: 0,
        leaveType: { code: 'PASSIF' },
      },
    ]);

    const result = await service.updateTotalDays('employee-1', {
      rhId: rhUser.id,
      year: 2026,
      total: 30,
      comment: 'Régularisation RH du total',
    });

    expect(leaveBalanceInitializer.initializeUserYear).toHaveBeenCalledWith(
      'employee-1',
      2026,
      prisma,
    );
    expect(leaveBalanceSync.syncUserYear).toHaveBeenCalledWith(
      'employee-1',
      2026,
      prisma,
    );
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-cp' },
      data: { carryover: 2, balanceAdjustment: 2 },
    });
    expect(
      leaveBalanceInitializer.refreshPaidDebtCarryover,
    ).toHaveBeenCalledWith('employee-1', 2027, prisma);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: rhUser.id,
          entity: 'LeaveBalance',
          entityId: 'employee-1',
          metadata: expect.objectContaining({
            source: 'rh_total_days_adjustment',
            previousTotal: 28,
            newTotal: 30,
            adjustmentDelta: 2,
            targetLeaveType: 'CP',
            newBalanceAdjustment: 2,
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ previousTotal: 28, total: 30 }),
    );
  });

  it('updates planned paid leave days and recalculates the end date', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
    prisma.user.findUnique.mockResolvedValueOnce(rhUser);
    prisma.leaveRequest.findUnique.mockResolvedValue({
      id: 'planned-request-1',
      reference: 'PLAN-2026-001',
      ownerId: 'employee-1',
      leaveTypeId: 'type-cp',
      startDate: new Date('2026-06-05T00:00:00.000Z'),
      endDate: new Date('2026-06-05T00:00:00.000Z'),
      days: 1,
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      owner: {
        matricule: 'EMP001',
        nom: 'Employee',
        prenom: 'Test',
      },
      leaveType: {
        code: 'CP',
        name: 'Conges payes',
        category: 'CONGE_PAYE',
      },
    });
    prisma.leaveRequest.update.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'planned-request-1',
        reference: 'PLAN-2026-001',
        ownerId: 'employee-1',
        leaveTypeId: 'type-cp',
        startDate: new Date('2026-06-05T00:00:00.000Z'),
        endDate: data.endDate,
        days: data.days,
      }),
    );

    const result = await service.updatePlannedDays('planned-request-1', {
      rhId: rhUser.id,
      days: 2,
      comment: 'Correction planning',
    });

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'planned-request-1' },
      data: {
        days: 2,
        endDate: new Date('2026-06-08T00:00:00.000Z'),
      },
      select: expect.any(Object),
    });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'planned-request-1',
      prisma,
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: rhUser.id,
          entity: 'LeaveRequest',
          entityId: 'planned-request-1',
          metadata: expect.objectContaining({
            source: 'rh_planned_days_adjustment',
            previousDays: 1,
            newDays: 2,
            previousEndDate: '2026-06-05',
            newEndDate: '2026-06-08',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        previousDays: 1,
        days: 2,
        endDate: '2026-06-08',
      }),
    );
  });

  it('approves an RH-reviewed request and notifies employee plus N+1', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();

    const result = await service.decideRequest('request-1', {
      rhId: rhUser.id,
      decision: 'approve',
    });

    expect(prisma.validation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-1',
        validatorId: rhUser.id,
        level: 3,
        decision: ValidationDecision.APPROVED,
      }),
    });
    expect(prisma.leaveRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'request-1',
          status: LeaveRequestStatus.IN_REVIEW,
        },
        data: expect.objectContaining({
          status: LeaveRequestStatus.APPROVED,
          cancelledAt: null,
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'employee-1',
          type: NotificationType.REQUEST_APPROVED,
          link: '/demandes',
        }),
        expect.objectContaining({
          userId: 'manager-1',
          type: NotificationType.REQUEST_APPROVED,
          link: '/manager/demandes',
        }),
      ]),
    });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );
    expect(emailService.sendMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'employee@upowa.org' }),
        expect.objectContaining({ to: 'manager@upowa.org' }),
      ]),
    );
    expect(result).toEqual({
      id: 'request-1',
      reference: 'DM-2026-001',
      status: LeaveRequestStatus.APPROVED,
    });
  });

  it('rejects non-RH users from deciding requests', async () => {
    const { prisma, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      ...rhUser,
      roles: [{ role: RoleType.EMPLOYE }],
    });

    await expect(
      service.decideRequest('request-1', {
        rhId: 'employee-1',
        decision: 'approve',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses RH decisions before manager validation', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ...request,
      status: LeaveRequestStatus.PENDING,
    });

    await expect(
      service.decideRequest('request-1', {
        rhId: rhUser.id,
        decision: 'reject',
        comment: 'Hors process',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-rejects overdue RH review requests before building the summary', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();
    const overdueRequest = {
      ...request,
      id: 'request-overdue',
      reference: 'DM-2026-OLD',
    };
    prisma.leaveRequest.findMany
      .mockResolvedValueOnce([overdueRequest])
      .mockResolvedValueOnce([]);
    prisma.user.findMany
      .mockResolvedValueOnce([{ email: 'employee@upowa.org' }])
      .mockResolvedValueOnce([]);

    const result = await service.findSummary({ year: '2026' });

    expect(prisma.validation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-overdue',
        validatorId: rhUser.id,
        level: 3,
        decision: ValidationDecision.REJECTED,
        comment: 'Refus automatique RH apres 7 jour(s) sans decision.',
      }),
    });
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-overdue' },
      data: expect.objectContaining({ status: LeaveRequestStatus.REJECTED }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.REJECT,
        entity: 'LeaveRequest',
        entityId: 'request-overdue',
        metadata: expect.objectContaining({ source: 'rh-auto' }),
      }),
    });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-overdue',
      prisma,
    );
    expect(emailService.sendMany).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'employee@upowa.org' }),
    ]);
    expect(result.totals.employees).toBe(0);
  });

  it('exposes parent leave type labels in RH request tables', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'request-paid',
          reference: 'CP-2026-001',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-02T00:00:00.000Z'),
          days: 2,
          status: LeaveRequestStatus.PENDING,
          submittedAt: new Date('2026-05-01T00:00:00.000Z'),
          leaveType: {
            code: 'ANC',
            name: 'Ancienneté',
            category: LeaveCategory.CONGE_PAYE,
          },
          owner: {
            id: 'employee-1',
            nom: 'Employee',
            prenom: 'Paid',
            department: { code: 'OPS', name: 'Operations' },
            n1: { nom: 'Manager', prenom: 'One' },
          },
        },
        {
          id: 'request-special',
          reference: 'PAT-2026-001',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: new Date('2026-07-03T00:00:00.000Z'),
          days: 3,
          status: LeaveRequestStatus.APPROVED,
          submittedAt: new Date('2026-06-01T00:00:00.000Z'),
          leaveType: {
            code: 'PAT',
            name: 'Congé paternité',
            category: LeaveCategory.CONGE_PATERNITE,
          },
          owner: {
            id: 'employee-2',
            nom: 'Employee',
            prenom: 'Special',
            department: { code: 'OPS', name: 'Operations' },
            n1: null,
          },
        },
        {
          id: 'request-maternity',
          reference: 'MAT-2026-001',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-10-01T00:00:00.000Z'),
          days: 90,
          status: LeaveRequestStatus.IN_REVIEW,
          submittedAt: new Date('2026-07-01T00:00:00.000Z'),
          leaveType: {
            code: 'MAT',
            name: 'Congé maternité',
            category: LeaveCategory.CONGE_MATERNITE,
          },
          owner: {
            id: 'employee-3',
            nom: 'Employee',
            prenom: 'Maternity',
            department: { code: 'OPS', name: 'Operations' },
            n1: null,
          },
        },
      ]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.department.findMany.mockResolvedValue([
      { code: 'OPS', name: 'Operations' },
    ]);

    const result = await service.findSummary({ year: '2026' });

    expect(result.planifications.map((row) => row.type)).toEqual([
      'Congés payés',
      'Congés spéciaux',
      'Congé maternité',
    ]);
  });

  it('imports approved historical leave requests and syncs balances', async () => {
    const { prisma, leaveBalanceSync, leaveBalanceInitializer, service } =
      createHarness();
    prisma.user.findMany
      .mockResolvedValueOnce([
        {
          id: 'employee-1',
          matricule: 'EMP001',
          nom: 'Employee',
          prenom: 'Test',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.importHistory({
      rhId: rhUser.id,
      rows: [
        {
          reference: 'OLD-2025-001',
          matricule: 'EMP001',
          category: 'pris',
          type: 'paye',
          startDate: '2025-04-01',
          endDate: '2025-04-05',
          days: 5,
        },
      ],
    });

    expect(leaveBalanceInitializer.initializeUserYear).toHaveBeenCalledWith(
      'employee-1',
      2025,
      prisma,
    );
    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: 'OLD-2025-001',
          ownerId: 'employee-1',
          leaveTypeId: 'type-cp',
          status: LeaveRequestStatus.APPROVED,
          submittedAt: new Date('2025-04-01T00:00:00.000Z'),
        }),
      }),
    );
    expect(prisma.validation.create).not.toHaveBeenCalled();
    expect(leaveBalanceSync.syncForKeys).toHaveBeenCalledWith(
      [
        {
          userId: 'employee-1',
          leaveTypeId: 'type-cp',
          year: 2025,
        },
      ],
      prisma,
    );
    expect(result.imported).toBe(1);
    expect(result.importedTaken).toBe(1);
    expect(result.importedPlanned).toBe(0);
    expect(result.totals).toEqual({
      days: 5,
      takenDays: 5,
      plannedDays: 0,
    });
  });

  it('imports planned historical rows as draft planned leave', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
    prisma.user.findMany
      .mockResolvedValueOnce([
        {
          id: 'employee-1',
          matricule: 'EMP001',
          nom: 'Employee',
          prenom: 'Test',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.importHistory({
      rhId: rhUser.id,
      rows: [
        {
          reference: 'PLAN-2025-001',
          matricule: 'EMP001',
          category: 'planifier',
          type: 'paye',
          startDate: '2025-08-12',
          endDate: '2025-08-20',
          days: 7,
        },
      ],
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: 'PLAN-2025-001',
          status: LeaveRequestStatus.DRAFT,
          submittedAt: null,
          decidedAt: null,
          reason: 'Planification importee par RH',
        }),
      }),
    );
    const createPayload = prisma.leaveRequest.create.mock.calls[0][0];
    expect(createPayload.data.validations).toBeUndefined();
    expect(prisma.validation.create).not.toHaveBeenCalled();
    expect(leaveBalanceSync.syncForKeys).toHaveBeenCalledWith(
      [
        {
          userId: 'employee-1',
          leaveTypeId: 'type-cp',
          year: 2025,
        },
      ],
      prisma,
    );
    expect(result.imported).toBe(1);
    expect(result.importedTaken).toBe(0);
    expect(result.importedPlanned).toBe(1);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        reference: 'PLAN-2025-001',
        category: 'planifier',
        statusCode: LeaveRequestStatus.DRAFT,
      }),
    );
    expect(result.totals).toEqual({
      days: 7,
      takenDays: 0,
      plannedDays: 7,
    });
  });
});
