/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  LeaveCategory,
  LeaveRequestStatus,
  NotificationType,
  Sexe,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { EmployeeLeaveRequestsService } from './leave-requests.service';

const user = {
  id: 'employee-1',
  email: 'employee@upowa.org',
  matricule: 'EMP001',
  nom: 'Employee',
  prenom: 'Test',
  n1Id: 'manager-1',
  n2Id: 'manager-2',
  n3Id: 'manager-3',
  sexe: Sexe.F,
  status: UserStatus.ACTIVE,
  department: {
    id: 'dept-1',
    code: 'OPS',
    name: 'Ops',
    managerId: 'manager-1',
  },
};

const leaveType = {
  id: 'type-1',
  code: 'CP',
  name: 'Congé payé',
  category: LeaveCategory.CONGE_PAYE,
};

const maternityLeaveType = {
  id: 'type-mat',
  code: 'MAT',
  name: 'Congés maternité',
  category: LeaveCategory.CONGE_MATERNITE,
};

function requestResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request-1',
    reference: 'DM-2026-TEST',
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    days: 3,
    reason: 'Repos',
    status: LeaveRequestStatus.PENDING,
    submittedAt: new Date('2026-05-29T10:00:00.000Z'),
    createdAt: new Date('2026-05-29T09:00:00.000Z'),
    leaveType,
    validations: [],
    ...overrides,
  };
}

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    leaveType: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    leaveBalance: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    publicHoliday: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  } as any;

  const emailService = {
    sendMany: jest.fn(),
  } as any;

  const leaveBalanceSync = {
    syncForRequest: jest.fn(),
    syncForKeys: jest.fn(),
  } as any;

  prisma.user.findUnique.mockResolvedValue(user);
  prisma.leaveType.findFirst.mockResolvedValue(leaveType);
  prisma.leaveType.findMany.mockResolvedValue([leaveType, maternityLeaveType]);
  prisma.leaveBalance.findUnique.mockResolvedValue({
    acquired: 30,
    carryover: 0,
    taken: 0,
    scheduled: 0,
  });
  prisma.leaveBalance.findMany.mockResolvedValue([
    {
      leaveTypeId: leaveType.id,
      acquired: 30,
      carryover: 0,
      taken: 0,
      scheduled: 0,
    },
  ]);
  prisma.publicHoliday.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([
    { id: 'manager-1', email: 'n1@upowa.org' },
    { id: 'manager-2', email: 'n2@upowa.org' },
    { id: 'manager-3', email: 'n3@upowa.org' },
  ]);
  prisma.leaveRequest.create.mockImplementation(({ data }) =>
    Promise.resolve(
      requestResponse({
        reference: 'DM-2026-CREATED',
        status: data.status,
        submittedAt: data.submittedAt,
        reason: data.reason,
        days: data.days,
      }),
    ),
  );
  prisma.leaveRequest.update.mockImplementation(({ data }) =>
    Promise.resolve(
      requestResponse({
        status: data.status ?? LeaveRequestStatus.DRAFT,
        submittedAt: data.submittedAt ?? new Date('2026-05-29T10:00:00.000Z'),
        days: data.days ?? 3,
      }),
    ),
  );

  return {
    prisma,
    emailService,
    leaveBalanceSync,
    service: new EmployeeLeaveRequestsService(
      prisma,
      emailService,
      leaveBalanceSync,
    ),
  };
}

describe('EmployeeLeaveRequestsService', () => {
  it('creates a submitted request and notifies N+1 plus N+2/N+3 watchers', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();

    const result = await service.create({
      userId: user.id,
      leaveTypeCode: leaveType.code,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      reason: 'Repos',
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveRequestStatus.PENDING,
          submittedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'manager-1',
          type: NotificationType.REQUEST_SUBMITTED,
          title: 'Nouvelle demande à valider',
        }),
        expect.objectContaining({
          userId: 'manager-2',
          title: 'Nouvelle demande à consulter',
        }),
        expect.objectContaining({
          userId: 'manager-3',
          title: 'Nouvelle demande à consulter',
        }),
      ]),
    });
    expect(emailService.sendMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'n1@upowa.org' }),
        expect.objectContaining({ to: 'n2@upowa.org' }),
        expect.objectContaining({ to: 'n3@upowa.org' }),
      ]),
    );
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );
    expect(result.status).toBe('pending');
  });

  it('creates a planned draft without notifying managers', async () => {
    const { prisma, emailService, service } = createHarness();

    const result = await service.create({
      userId: user.id,
      leaveTypeCode: leaveType.code,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      draft: true,
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveRequestStatus.DRAFT,
          submittedAt: null,
        }),
      }),
    );
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(emailService.sendMany).toHaveBeenCalledWith([]);
    expect(result.status).toBe('planned');
    expect(result.stext).toBe('Planifié');
  });

  it('does not count a public holiday as a working leave day', async () => {
    const { prisma, service } = createHarness();
    prisma.publicHoliday.findMany.mockResolvedValue([
      {
        date: new Date('2026-06-02T00:00:00.000Z'),
        recurring: false,
      },
    ]);

    await service.create({
      userId: user.id,
      leaveTypeCode: leaveType.code,
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      draft: true,
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ days: 2 }),
      }),
    );
  });

  it('creates a maternity leave request only for the full 90-day entitlement', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveType.findFirst.mockResolvedValue(maternityLeaveType);
    prisma.leaveBalance.findUnique.mockResolvedValue({
      acquired: 90,
      carryover: 0,
      taken: 0,
      scheduled: 0,
    });

    await service.create({
      userId: user.id,
      leaveTypeCode: maternityLeaveType.code,
      startDate: '2026-06-01',
      endDate: '2026-10-02',
      reason: 'Congé maternité',
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaveTypeId: maternityLeaveType.id,
          days: 90,
        }),
      }),
    );
  });

  it('rejects a partial maternity leave request', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveType.findFirst.mockResolvedValue(maternityLeaveType);
    prisma.leaveBalance.findUnique.mockResolvedValue({
      acquired: 90,
      carryover: 0,
      taken: 0,
      scheduled: 0,
    });

    await expect(
      service.create({
        userId: user.id,
        leaveTypeCode: maternityLeaveType.code,
        startDate: '2026-06-01',
        endDate: '2026-07-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
  });

  it('resubmits an in-review request and returns the review comment when the employee updates it', async () => {
    const { prisma, emailService, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: LeaveRequestStatus.IN_REVIEW,
      submittedAt: new Date('2026-05-29T09:00:00.000Z'),
      leaveTypeId: leaveType.id,
      leaveType,
      days: 3,
      validations: [{ decision: ValidationDecision.REVIEW_REQUESTED }],
    });
    prisma.leaveRequest.update.mockResolvedValue(
      requestResponse({
        status: LeaveRequestStatus.PENDING,
        validations: [
          {
            decision: ValidationDecision.REVIEW_REQUESTED,
            comment: 'Merci de corriger la date de fin',
            decidedAt: new Date('2026-05-30T10:00:00.000Z'),
          },
        ],
      }),
    );

    const result = await service.update('request-1', {
      userId: user.id,
      startDate: '2026-06-04',
      endDate: '2026-06-05',
    });

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveRequestStatus.PENDING,
          submittedAt: expect.any(Date),
          decidedAt: null,
          cancelledAt: null,
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(emailService.sendMany).toHaveBeenCalledWith(expect.any(Array));
    expect(result.reviewComment).toBe('Merci de corriger la date de fin');
    expect(result.canEdit).toBe(true);
  });

  it('does not credit old review-request days during balance validation', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-05T00:00:00.000Z'),
      status: LeaveRequestStatus.DRAFT,
      submittedAt: new Date('2026-05-29T09:00:00.000Z'),
      leaveTypeId: leaveType.id,
      leaveType,
      days: 5,
      validations: [{ decision: ValidationDecision.REVIEW_REQUESTED }],
    });
    prisma.leaveBalance.findMany.mockResolvedValue([
      {
        leaveTypeId: leaveType.id,
        acquired: 2,
        carryover: 0,
        taken: 0,
        scheduled: 0,
      },
    ]);
    prisma.leaveBalance.findUnique.mockResolvedValue({
      acquired: 2,
      carryover: 0,
      taken: 0,
      scheduled: 0,
    });

    await expect(
      service.update('request-1', {
        userId: user.id,
        startDate: '2026-06-08',
        endDate: '2026-06-10',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not let employees edit requests already awaiting RH review', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: LeaveRequestStatus.IN_REVIEW,
      submittedAt: new Date('2026-05-29T09:00:00.000Z'),
      leaveTypeId: leaveType.id,
      leaveType,
      days: 3,
      validations: [{ decision: ValidationDecision.APPROVED }],
    });

    await expect(
      service.update('request-1', {
        userId: user.id,
        startDate: '2026-06-04',
        endDate: '2026-06-05',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('submits a planned draft and sends notifications', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValue({
      id: 'request-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      leaveTypeId: leaveType.id,
      leaveType,
      days: 3,
      validations: [],
    });

    const result = await service.submit('request-1', { userId: user.id });

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LeaveRequestStatus.PENDING,
          submittedAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalled();
    expect(result.status).toBe('pending');
  });

  it('only permanently deletes unsubmitted planned drafts', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValueOnce({
      id: 'request-1',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: LeaveRequestStatus.DRAFT,
      submittedAt: null,
      leaveTypeId: leaveType.id,
      leaveType,
      days: 3,
      validations: [],
    });

    await expect(
      service.remove('request-1', { userId: user.id }),
    ).resolves.toEqual({
      id: 'request-1',
      deleted: true,
    });
    expect(prisma.leaveRequest.delete).toHaveBeenCalledWith({
      where: { id: 'request-1' },
    });

    prisma.leaveRequest.findFirst.mockResolvedValueOnce({
      id: 'request-2',
      startDate: new Date('2026-06-01T00:00:00.000Z'),
      endDate: new Date('2026-06-03T00:00:00.000Z'),
      status: LeaveRequestStatus.DRAFT,
      submittedAt: new Date('2026-05-29T09:00:00.000Z'),
      leaveTypeId: leaveType.id,
      leaveType,
      days: 3,
      validations: [{ decision: ValidationDecision.REVIEW_REQUESTED }],
    });

    await expect(
      service.remove('request-2', { userId: user.id }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
