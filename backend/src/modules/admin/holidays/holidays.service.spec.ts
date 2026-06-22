import { AdminHolidaysService } from './holidays.service';

describe('AdminHolidaysService', () => {
  it('recalculates affected requests and balances after creating a holiday', async () => {
    const transaction = {
      leaveRequest: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const prisma = {
      publicHoliday: {
        create: jest.fn().mockResolvedValue({
          id: 'holiday-1',
          date: new Date('2026-06-02T00:00:00.000Z'),
          name: 'Jour férié',
          country: 'CM',
          recurring: false,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            date: new Date('2026-06-02T00:00:00.000Z'),
            recurring: false,
          },
        ]),
      },
      leaveRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'request-1',
            ownerId: 'employee-1',
            leaveTypeId: 'type-1',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-06-03T00:00:00.000Z'),
            days: 3,
            leaveType: { code: 'CP' },
          },
        ]),
      },
      $transaction: jest.fn(async (callback) => callback(transaction)),
    } as any;
    const leaveBalanceSync = {
      syncForKeys: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new AdminHolidaysService(prisma, leaveBalanceSync);

    await service.create({
      date: '2026-06-02',
      name: 'Jour férié',
      country: 'CM',
      recurring: false,
    });

    expect(transaction.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        days: 2,
        endDate: new Date('2026-06-03T00:00:00.000Z'),
      },
    });
    expect(leaveBalanceSync.syncForKeys).toHaveBeenCalledWith(
      [
        {
          userId: 'employee-1',
          leaveTypeId: 'type-1',
          year: 2026,
        },
      ],
      transaction,
    );
  });
});
