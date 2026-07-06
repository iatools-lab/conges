import { BadRequestException } from '@nestjs/common';
import {
  LeaveCategory,
  LeaveRequestStatus,
  Sexe,
  UserStatus,
} from '@prisma/client';
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
    leaveRequest: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  } as any;
  const emailService = { sendMany: jest.fn() } as any;
  const leaveBalanceSync = { syncForRequest: jest.fn() } as any;
  const leaveBalanceInitializer = {
    initializeUserYear: jest.fn().mockResolvedValue({}),
  } as any;

  return {
    prisma,
    leaveBalanceSync,
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

  it('keeps special-leave proof optional and deducts every subtype from the shared 12-day pool', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      id: 'employee-1',
      email: 'employee@example.com',
      matricule: 'EMP001',
      nom: 'Doe',
      prenom: 'John',
      n1Id: 'manager-1',
      n2Id: null,
      n3Id: null,
      sexe: Sexe.M,
      dateEmbauche: new Date('2020-01-15T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      department: null,
    });
    prisma.leaveType.findMany.mockResolvedValue([
      {
        id: 'special-type',
        code: 'SPE',
        name: 'Congé spécial',
        category: LeaveCategory.CONGE_SPECIAL,
        requiresProof: true,
      },
      {
        id: 'paternity-type',
        code: 'PAT',
        name: 'Congé paternité',
        category: LeaveCategory.CONGE_PATERNITE,
        requiresProof: true,
      },
      {
        id: 'sick-type',
        code: 'MAL',
        name: 'Congé maladie',
        category: LeaveCategory.CONGE_MALADIE,
        requiresProof: true,
      },
    ]);
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        leaveTypeId: 'special-type',
        acquired: 12,
        carryover: 0,
        taken: 0,
        scheduled: 0,
      },
      {
        leaveTypeId: 'paternity-type',
        acquired: 3,
        carryover: 0,
        taken: 3,
        scheduled: 0,
      },
      {
        leaveTypeId: 'sick-type',
        acquired: 0,
        carryover: 0,
        taken: 0,
        scheduled: 0,
      },
    ]);
    const created = {
      id: 'request-1',
      reference: 'DRAFT-001',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-01T00:00:00.000Z'),
      days: 1,
      reason: null,
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      leaveType: {
        id: 'paternity-type',
        code: 'PAT',
        name: 'Congé paternité',
        category: LeaveCategory.CONGE_PATERNITE,
        requiresProof: true,
      },
      attachments: [],
      validations: [],
    };
    prisma.leaveRequest.create.mockResolvedValue(created);
    prisma.$transaction.mockImplementation((callback: (tx: any) => unknown) =>
      callback(prisma),
    );

    await expect(
      service.create({
        userId: 'employee-1',
        leaveTypeCode: 'SPECIAL',
        leaveSubtypeCode: 'PAT',
        startDate: '2026-06-01',
        endDate: '2026-06-01',
        draft: true,
      } as any),
    ).resolves.toMatchObject({ id: 'request-1', hasProof: false });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );

    await expect(
      service.create({
        userId: 'employee-1',
        leaveTypeCode: 'SPECIAL',
        leaveSubtypeCode: 'PAT',
        startDate: '2026-06-01',
        endDate: '2026-06-12',
        draft: true,
      } as any),
    ).rejects.toThrow(/plafond disponible.*9/i);
  });
});
