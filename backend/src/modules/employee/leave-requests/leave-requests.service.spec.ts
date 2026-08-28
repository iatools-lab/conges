import {
  EventType,
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
      aggregate: jest.fn(),
    },
    event: {
      findMany: jest.fn(),
      count: jest.fn(),
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
  prisma.event.findMany.mockResolvedValue([]);
  prisma.event.count.mockResolvedValue(0);
  prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });

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
  it('allows paid leave taking before the first work anniversary while keeping acquired days visible', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
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
        defaultDays: 24,
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
    const created = {
      id: 'request-1',
      reference: 'DRAFT-001',
      startDate: new Date('2026-06-22T00:00:00.000Z'),
      endDate: new Date('2026-06-22T00:00:00.000Z'),
      days: 1,
      reason: null,
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      leaveType: {
        id: 'cp-type',
        code: 'CP',
        name: 'Congés payés',
        category: LeaveCategory.CONGE_PAYE,
        defaultDays: 24,
        requiresProof: false,
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
        leaveTypeCode: 'PAYE',
        startDate: '2026-06-22',
        endDate: '2026-06-22',
        draft: true,
      } as any),
    ).resolves.toMatchObject({ id: 'request-1', jours: 1 });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );
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
        defaultDays: 12,
        requiresProof: true,
      },
      {
        id: 'paternity-type',
        code: 'PAT',
        name: 'Congé paternité',
        category: LeaveCategory.CONGE_PATERNITE,
        defaultDays: 3,
        requiresProof: true,
      },
      {
        id: 'sick-type',
        code: 'MAL',
        name: 'Congé maladie',
        category: LeaveCategory.CONGE_MALADIE,
        defaultDays: 0,
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
    prisma.event.findMany.mockResolvedValue([
      {
        type: EventType.BIRTH,
        eventDate: new Date('2026-06-01T00:00:00.000Z'),
        description: '[PAT] - Congé paternité (3 jours)',
      },
    ]);
    prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });
    const created = {
      id: 'request-1',
      reference: 'DRAFT-001',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      days: 3,
      reason: null,
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      leaveType: {
        id: 'paternity-type',
        code: 'PAT',
        name: 'Congé paternité',
        category: LeaveCategory.CONGE_PATERNITE,
        defaultDays: 3,
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
        endDate: '2026-06-03',
        draft: true,
      } as any),
    ).resolves.toMatchObject({ id: 'request-1', hasProof: false, jours: 3 });
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
        endDate: '2026-06-04',
        draft: true,
      } as any),
    ).rejects.toThrow(/durée demandée|droit du congé spécial/i);
  });
  it('requires the approved matching exceptional event and enforces its exact days', async () => {
    const { prisma, leaveBalanceSync, service } = createHarness();
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
      dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      department: { id: 'dep-1', code: 'OPS', name: 'Operations' },
    });
    prisma.leaveType.findFirst.mockResolvedValue({
      id: 'death-spouse-type',
      code: 'DEC_CONJ',
      name: 'Deces du conjoint du travailleur',
      category: LeaveCategory.CONGE_SPECIAL,
      defaultDays: 5,
      requiresProof: false,
    });
    prisma.leaveType.findMany.mockResolvedValue([
      {
        id: 'death-spouse-type',
        code: 'DEC_CONJ',
        name: 'Deces du conjoint du travailleur',
        category: LeaveCategory.CONGE_SPECIAL,
        defaultDays: 5,
        requiresProof: false,
      },
    ]);
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        leaveTypeId: 'death-spouse-type',
        acquired: 5,
        carryover: 0,
        taken: 0,
        scheduled: 0,
      },
    ]);
    prisma.leaveBalance.findUnique.mockResolvedValue({
      acquired: 5,
      carryover: 0,
      taken: 0,
      scheduled: 0,
    });
    prisma.event.findMany.mockResolvedValue([
      {
        type: EventType.DEATH,
        eventDate: new Date('2026-07-10T00:00:00.000Z'),
        description: '[DEC_CONJ] - Deces du conjoint du travailleur',
      },
    ]);
    prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });
    const created = {
      id: 'request-2',
      reference: 'DRAFT-002',
      startDate: new Date('2026-07-13T00:00:00.000Z'),
      endDate: new Date('2026-07-17T00:00:00.000Z'),
      days: 5,
      reason: null,
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      leaveType: {
        id: 'death-spouse-type',
        code: 'DEC_CONJ',
        name: 'Deces du conjoint du travailleur',
        category: LeaveCategory.CONGE_SPECIAL,
        defaultDays: 5,
        requiresProof: false,
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
        leaveSubtypeCode: 'DEC_CONJ',
        startDate: '2026-07-13',
        endDate: '2026-07-17',
        draft: true,
      } as any),
    ).resolves.toMatchObject({ id: 'request-2', jours: 5 });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-2',
      prisma,
    );

    await expect(
      service.create({
        userId: 'employee-1',
        leaveTypeCode: 'SPECIAL',
        leaveSubtypeCode: 'DEC_CONJ',
        startDate: '2026-07-13',
        endDate: '2026-07-20',
        draft: true,
      } as any),
    ).rejects.toThrow(/durée demandée|droit du congé spécial/i);
  });
});
