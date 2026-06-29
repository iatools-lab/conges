import { BadRequestException } from '@nestjs/common';
import { LeaveCategory, Sexe, UserStatus } from '@prisma/client';
import { EmployeeLeaveRequestsService } from './leave-requests.service';

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    publicHoliday: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    leaveType: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    leaveBalance: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  } as any;
  const emailService = { sendMany: jest.fn() } as any;
  const leaveBalanceSync = { syncForRequest: jest.fn() } as any;
  const leaveBalanceInitializer = {
    initializeUserYear: jest.fn().mockResolvedValue({}),
  } as any;

  return {
    prisma,
    leaveBalanceInitializer,
    service: new EmployeeLeaveRequestsService(
      prisma,
      emailService,
      leaveBalanceSync,
      leaveBalanceInitializer,
    ),
  };
}

describe('EmployeeLeaveRequestsService', () => {
  it('blocks paid leave taking before the first work anniversary while keeping acquired days visible', async () => {
    const { prisma, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      id: 'employee-1',
      email: 'employee@example.com',
      matricule: 'EMP001',
      nom: 'Doe',
      prenom: 'Jane',
      n1Id: 'manager-1',
      n2Id: null,
      n3Id: null,
      sexe: Sexe.F,
      dateEmbauche: new Date('2026-01-15T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      department: null,
    });
    prisma.leaveType.findMany.mockResolvedValue([
      {
        id: 'cp-type',
        code: 'CP',
        name: 'Congés payés',
        category: LeaveCategory.CONGE_PAYE,
        requiresProof: false,
      },
    ]);
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        leaveTypeId: 'cp-type',
        acquired: 8,
        carryover: 0,
        taken: 0,
        scheduled: 0,
      },
    ]);

    await expect(
      service.create({
        userId: 'employee-1',
        leaveTypeCode: 'PAYE',
        startDate: '2026-06-22',
        endDate: '2026-06-22',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
