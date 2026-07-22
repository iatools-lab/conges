import { LeaveBalanceInitializerService } from './leave-balance-initializer.service';

describe('LeaveBalanceInitializerService', () => {
  it('creates missing balances without overwriting existing acquired days by default', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'employee-1',
            sexe: 'M',
            dateEmbauche: new Date('2025-04-10T00:00:00.000Z'),
            passifInitial: 0,
            children: [],
            events: [],
          },
        ]),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'type-cp',
            code: 'CP',
            name: 'Congés payés',
            category: 'CONGE_PAYE',
            defaultDays: 24,
          },
        ]),
      },
      leaveBalance: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { userId: 'employee-1', leaveTypeId: 'type-cp' },
          ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const leaveEntitlements = {
      getAcquiredDays: jest.fn().mockReturnValue(24),
    } as any;
    const service = new LeaveBalanceInitializerService(
      prisma,
      leaveEntitlements,
    );

    const result = await service.initializeUserYear('employee-1', 2026);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ created: 0, updated: 0, skipped: 1 }),
    );
  });

  it('refreshes existing acquired days only when explicitly requested', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'employee-1',
            sexe: 'M',
            dateEmbauche: new Date('2025-04-10T00:00:00.000Z'),
            passifInitial: 0,
            children: [],
            events: [],
          },
        ]),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'type-cp',
            code: 'CP',
            name: 'Congés payés',
            category: 'CONGE_PAYE',
            defaultDays: 24,
          },
        ]),
      },
      leaveBalance: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { userId: 'employee-1', leaveTypeId: 'type-cp' },
          ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const leaveEntitlements = {
      getAcquiredDays: jest.fn().mockReturnValue(24),
    } as any;
    const service = new LeaveBalanceInitializerService(
      prisma,
      leaveEntitlements,
    );

    const result = await service.initializeUserYear(
      'employee-1',
      2026,
      prisma,
      true,
    );

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { acquired: 24, carryover: 0 },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ created: 0, updated: 1, skipped: 0 }),
    );
  });

  it('keeps RH total balance adjustments when employee entitlements are refreshed', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'employee-1',
            sexe: 'M',
            dateEmbauche: new Date('2025-04-10T00:00:00.000Z'),
            passifInitial: 0,
            children: [],
            events: [],
          },
        ]),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'type-cp',
            code: 'CP',
            name: 'Congés payés',
            category: 'CONGE_PAYE',
            defaultDays: 24,
          },
        ]),
      },
      leaveBalance: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              userId: 'employee-1',
              leaveTypeId: 'type-cp',
              balanceAdjustment: 5,
            },
          ]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const leaveEntitlements = {
      getAcquiredDays: jest.fn().mockReturnValue(24),
    } as any;
    const service = new LeaveBalanceInitializerService(
      prisma,
      leaveEntitlements,
    );

    await service.initializeUserYear('employee-1', 2026, prisma, true);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { acquired: 24, carryover: 5 },
      }),
    );
  });

  it('creates next-year CP with a negative carryover when the previous paid total is overdrawn', async () => {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'employee-1',
            sexe: 'M',
            dateEmbauche: new Date('2020-04-10T00:00:00.000Z'),
            passifInitial: 0,
            children: [],
            events: [],
          },
        ]),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'type-cp',
            code: 'CP',
            name: 'Congés payés',
            category: 'CONGE_PAYE',
            defaultDays: 24,
          },
        ]),
      },
      leaveBalance: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              userId: 'employee-1',
              acquired: 24,
              carryover: 0,
              taken: 28,
              scheduled: 0,
            },
          ])
          .mockResolvedValueOnce([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const leaveEntitlements = {
      getAcquiredDays: jest.fn().mockReturnValue(24),
    } as any;
    const service = new LeaveBalanceInitializerService(
      prisma,
      leaveEntitlements,
    );

    await service.initializeUserYear('employee-1', 2027);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          year: 2027,
          carryover: -4,
        }),
      }),
    );
  });

  it('refreshes current and historical years after employee data changes', async () => {
    const prisma = {
      leaveBalance: {
        findMany: jest.fn().mockResolvedValue([{ year: 2024 }, { year: 2025 }]),
      },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            startDate: new Date('2023-04-10T00:00:00.000Z'),
            endDate: new Date('2023-04-14T00:00:00.000Z'),
          },
        ]),
      },
    } as any;
    const service = new LeaveBalanceInitializerService(prisma, {} as any);
    const initializeUserYear = jest
      .spyOn(service, 'initializeUserYear')
      .mockResolvedValue({} as any);

    const result = await service.refreshUserEntitlements('employee-1');

    const expectedYears = Array.from(
      new Set([2023, 2024, 2025, new Date().getUTCFullYear()]),
    ).sort((left, right) => left - right);
    expect(result.years).toEqual(expectedYears);
    expect(initializeUserYear.mock.calls).toEqual(
      expectedYears.map((year) => ['employee-1', year, prisma, true]),
    );
  });
});
