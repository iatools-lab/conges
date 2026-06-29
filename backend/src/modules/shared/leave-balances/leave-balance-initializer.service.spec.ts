import { LeaveBalanceInitializerService } from './leave-balance-initializer.service';

describe('LeaveBalanceInitializerService', () => {
  it('refreshes current and historical years after employee data changes', async () => {
    const prisma = {
      leaveBalance: {
        findMany: jest.fn().mockResolvedValue([{ year: 2024 }, { year: 2025 }]),
      },
      leaveRequest: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { startDate: new Date('2023-04-10T00:00:00.000Z') },
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
      expectedYears.map((year) => ['employee-1', year, prisma]),
    );
  });
});
