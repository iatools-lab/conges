import { LeaveRequestStatus } from '@prisma/client';
import { LeaveBalanceSyncService } from './leave-balance-sync.service';

function createHarness() {
  const prisma = {
    leaveRequest: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    leaveBalance: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
  } as any;

  return { prisma, service: new LeaveBalanceSyncService(prisma) };
}

describe('LeaveBalanceSyncService', () => {
  it('counts past approvals as taken and future or pending requests as scheduled', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ownerId: 'employee-1',
      leaveTypeId: 'type-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
    });
    prisma.leaveRequest.aggregate
      .mockResolvedValueOnce({ _sum: { days: 4 } })
      .mockResolvedValueOnce({ _sum: { days: 7 } });

    await service.syncForRequest('request-1');

    expect(prisma.leaveRequest.aggregate).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({ status: LeaveRequestStatus.APPROVED }),
      _sum: { days: true },
    });
    expect(prisma.leaveRequest.aggregate).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        OR: [
          {
            status: LeaveRequestStatus.APPROVED,
            endDate: { gte: expect.any(Date) },
          },
          {
            status: {
              in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
            },
          },
          {
            status: LeaveRequestStatus.DRAFT,
            submittedAt: null,
          },
        ],
      }),
      _sum: { days: true },
    });
    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ taken: 4, scheduled: 7 }),
        update: { taken: 4, scheduled: 7 },
      }),
    );
  });

  it('keeps the RH taken-days adjustment during synchronization', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveBalance.findUnique.mockResolvedValue({ takenAdjustment: -2 });
    prisma.leaveRequest.aggregate
      .mockResolvedValueOnce({ _sum: { days: 10 } })
      .mockResolvedValueOnce({ _sum: { days: 0 } });

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { taken: 8, scheduled: 0 },
      }),
    );
  });

  it('deduplicates balance keys before syncing', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });

    await service.syncForKeys([
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
      { userId: 'employee-1', leaveTypeId: 'type-1', year: 2026 },
    ]);

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledTimes(1);
  });
});
