import { LeaveCategory, LeaveRequestStatus, Sexe } from '@prisma/client';
import { LeaveBalanceSyncService } from './leave-balance-sync.service';

function createHarness() {
  const prisma = {
    leaveRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    publicHoliday: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    leaveBalance: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'employee-1',
        sexe: Sexe.M,
        dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
        passifInitial: 0,
        children: [],
        events: [],
      }),
    },
    leaveType: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'type-1',
        code: 'CP',
        name: 'Congés payés',
        category: LeaveCategory.CONGE_PAYE,
        defaultDays: 24,
      }),
    },
  } as any;
  const leaveEntitlements = {
    getAcquiredDays: jest.fn().mockReturnValue(24),
  } as any;
  const leaveBalanceInitializer = {
    refreshPaidDebtCarryover: jest.fn().mockResolvedValue({}),
  } as any;

  return {
    prisma,
    leaveEntitlements,
    leaveBalanceInitializer,
    service: new LeaveBalanceSyncService(
      prisma,
      leaveEntitlements,
      leaveBalanceInitializer,
    ),
  };
}

describe('LeaveBalanceSyncService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts past approvals as taken and future or pending requests as scheduled', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ownerId: 'employee-1',
      leaveTypeId: 'type-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-08-11T00:00:00.000Z'),
    });
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-04T00:00:00.000Z'),
        status: LeaveRequestStatus.APPROVED,
        submittedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-07T00:00:00.000Z'),
        status: LeaveRequestStatus.APPROVED,
        submittedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
      {
        startDate: new Date('2026-08-10T00:00:00.000Z'),
        endDate: new Date('2026-08-11T00:00:00.000Z'),
        status: LeaveRequestStatus.PENDING,
        submittedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);

    await service.syncForRequest('request-1');

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        ownerId: 'employee-1',
        leaveTypeId: 'type-1',
        startDate: { lt: new Date('2027-04-01T00:00:00.000Z') },
        endDate: { gte: new Date('2026-04-01T00:00:00.000Z') },
      }),
      select: {
        startDate: true,
        endDate: true,
        days: true,
        status: true,
        submittedAt: true,
      },
    });
    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acquired: 24,
          taken: 4,
          scheduled: 7,
        }),
        update: { taken: 4, scheduled: 7 },
      }),
    );
  });

  it('splits a planned request that crosses March 31 between two leave years', async () => {
    const { prisma, service } = createHarness();
    const crossingRequest = {
      startDate: new Date('2027-03-28T00:00:00.000Z'),
      endDate: new Date('2027-04-04T00:00:00.000Z'),
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
    };
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ownerId: 'employee-1',
      leaveTypeId: 'type-1',
      startDate: crossingRequest.startDate,
      endDate: crossingRequest.endDate,
    });
    prisma.leaveRequest.findMany.mockResolvedValue([crossingRequest]);

    await service.syncForRequest('request-crossing');

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_leaveTypeId_year: {
            userId: 'employee-1',
            leaveTypeId: 'type-1',
            year: 2026,
          },
        },
        update: { taken: 0, scheduled: 3 },
      }),
    );
    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_leaveTypeId_year: {
            userId: 'employee-1',
            leaveTypeId: 'type-1',
            year: 2027,
          },
        },
        update: { taken: 0, scheduled: 2 },
      }),
    );
  });

  it('keeps the RH taken-days adjustment during synchronization', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveBalance.findUnique.mockResolvedValue({
      acquired: 24,
      takenAdjustment: -2,
    });
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-12T00:00:00.000Z'),
        status: LeaveRequestStatus.APPROVED,
        submittedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { taken: 8, scheduled: 0 },
      }),
    );
  });

  it('uses the stored request days as the source of truth for taken balances', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findMany.mockResolvedValue([
      {
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-05T00:00:00.000Z'),
        days: 7,
        status: LeaveRequestStatus.APPROVED,
        submittedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { taken: 7, scheduled: 0 },
      }),
    );
  });

  it('restores scheduled days when RH rejects a request approved by N+1', async () => {
    const { prisma, service } = createHarness();
    const requestSnapshot = {
      ownerId: 'employee-1',
      leaveTypeId: 'type-1',
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-07T00:00:00.000Z'),
    };
    prisma.leaveRequest.findUnique.mockResolvedValue(requestSnapshot);
    prisma.leaveRequest.findMany
      .mockResolvedValueOnce([
        {
          startDate: requestSnapshot.startDate,
          endDate: requestSnapshot.endDate,
          status: LeaveRequestStatus.IN_REVIEW,
          submittedAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    await service.syncForRequest('request-1');
    await service.syncForRequest('request-1');

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: {
          in: [
            LeaveRequestStatus.DRAFT,
            LeaveRequestStatus.PENDING,
            LeaveRequestStatus.IN_REVIEW,
            LeaveRequestStatus.APPROVED,
          ],
        },
      }),
      select: {
        startDate: true,
        endDate: true,
        days: true,
        status: true,
        submittedAt: true,
      },
    });
    expect(prisma.leaveBalance.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: { taken: 0, scheduled: 5 },
      }),
    );
    expect(prisma.leaveBalance.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: { taken: 0, scheduled: 0 },
      }),
    );
  });

  it('deduplicates balance keys before syncing', async () => {
    const { prisma, service } = createHarness();

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledTimes(1);
  });

  it('refreshes the next leave year paid debt carryover after synchronization', async () => {
    const { prisma, leaveBalanceInitializer, service } = createHarness();

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(
      leaveBalanceInitializer.refreshPaidDebtCarryover,
    ).toHaveBeenCalledTimes(1);
    expect(
      leaveBalanceInitializer.refreshPaidDebtCarryover,
    ).toHaveBeenCalledWith('employee-1', 2027, prisma);
  });
});
