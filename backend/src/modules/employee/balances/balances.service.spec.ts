import {
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Sexe,
  UserStatus,
} from '@prisma/client';
import { EmployeeBalancesService } from './balances.service';

describe('EmployeeBalancesService', () => {
  it('uses one shared 12-day balance while returning every special leave type', async () => {
    const leaveTypes = [
      {
        id: 'special-type',
        code: 'SPE',
        name: 'Congé spécial',
        category: LeaveCategory.CONGE_SPECIAL,
        defaultDays: 12,
      },
      {
        id: 'paternity-type',
        code: 'PAT',
        name: 'Congé paternité',
        category: LeaveCategory.CONGE_PATERNITE,
        defaultDays: 3,
      },
      {
        id: 'sick-type',
        code: 'MAL',
        name: 'Congé maladie',
        category: LeaveCategory.CONGE_MALADIE,
        defaultDays: 0,
      },
    ];
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'employee-1',
          status: UserStatus.ACTIVE,
          sexe: Sexe.M,
          dateEmbauche: new Date('2020-01-15T00:00:00.000Z'),
          passifInitial: 0,
          children: [],
          events: [
            {
              type: EventType.BIRTH,
              eventDate: new Date('2026-02-01T00:00:00.000Z'),
              processed: true,
            },
          ],
        }),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue(leaveTypes),
      },
      leaveRequest: {
        aggregate: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            _sum: {
              days:
                where.leaveTypeId === 'paternity-type' &&
                where.status === LeaveRequestStatus.APPROVED
                  ? 3
                  : 0,
            },
          }),
        ),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({ takenAdjustment: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest
          .fn()
          .mockResolvedValueOnce(
            leaveTypes.map((leaveType) => ({
              id: `balance-${leaveType.code}`,
              acquired:
                leaveType.code === 'SPE'
                  ? 12
                  : leaveType.code === 'PAT'
                    ? 3
                    : 0,
              taken: leaveType.code === 'PAT' ? 3 : 0,
              scheduled: leaveType.code === 'SPE' ? 2 : 0,
              carryover: 0,
              leaveType,
            })),
          )
          .mockResolvedValueOnce([]),
      },
    } as any;
    const leaveEntitlements = {
      getAcquiredDays: jest.fn(({ leaveType }) =>
        leaveType.code === 'SPE' ? 12 : leaveType.code === 'PAT' ? 3 : 0,
      ),
      getBalanceLabel: jest.fn((leaveType) => leaveType.name),
    } as any;
    const leaveBalanceSync = {
      syncUserYear: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new EmployeeBalancesService(
      prisma,
      leaveEntitlements,
      leaveBalanceSync,
    );

    const result = await service.findBalances('employee-1', '2026');

    expect(result.specialDetails).toHaveLength(3);
    expect(result.specialTotals).toEqual({
      acquired: 12,
      taken: 3,
      scheduled: 2,
      remaining: 7,
    });
    expect(result.specialRows[0]).toMatchObject({
      code: 'SPECIAL',
      acquired: 12,
      taken: 3,
      scheduled: 2,
      remaining: 7,
    });
  });
});
