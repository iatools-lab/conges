/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  AuditAction,
  LeaveRequestStatus,
  NotificationType,
  RoleType,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { RhGlobalViewService } from './global-view.service';

const rhUser = {
  id: 'rh-1',
  email: 'rh@upowa.org',
  nom: 'RH',
  prenom: 'Test',
  status: UserStatus.ACTIVE,
  roles: [{ role: RoleType.RH }],
};

const request = {
  id: 'request-1',
  reference: 'DM-2026-001',
  status: LeaveRequestStatus.IN_REVIEW,
  ownerId: 'employee-1',
  startDate: new Date('2026-06-01T00:00:00.000Z'),
  leaveTypeId: 'type-1',
  owner: {
    id: 'employee-1',
    nom: 'Employee',
    prenom: 'Test',
    n1Id: 'manager-1',
  },
};

function createHarness() {
  const prisma = {
    department: {
      findMany: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    validation: {
      create: jest.fn(),
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

  const configService = {
    get: jest.fn().mockReturnValue('7'),
  } as any;

  const leaveBalanceSync = {
    syncForRequest: jest.fn(),
    syncYear: jest.fn(),
  } as any;

  prisma.user.findFirst.mockResolvedValue(rhUser);
  prisma.user.findUnique.mockResolvedValue(rhUser);
  prisma.user.findMany.mockResolvedValue([
    { email: 'employee@upowa.org' },
    { email: 'manager@upowa.org' },
  ]);
  prisma.leaveRequest.findMany.mockResolvedValue([]);
  prisma.leaveRequest.findUnique.mockResolvedValue(request);
  prisma.department.findMany.mockResolvedValue([]);

  return {
    prisma,
    emailService,
    configService,
    leaveBalanceSync,
    service: new RhGlobalViewService(
      prisma,
      emailService,
      configService,
      leaveBalanceSync,
    ),
  };
}

describe('RhGlobalViewService', () => {
  it('approves an RH-reviewed request and notifies employee plus N+1', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();

    const result = await service.decideRequest('request-1', {
      rhId: rhUser.id,
      decision: 'approve',
    });

    expect(prisma.validation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-1',
        validatorId: rhUser.id,
        level: 3,
        decision: ValidationDecision.APPROVED,
      }),
    });
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: expect.objectContaining({
        status: LeaveRequestStatus.APPROVED,
        cancelledAt: null,
      }),
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          userId: 'employee-1',
          type: NotificationType.REQUEST_APPROVED,
          link: '/demandes',
        }),
        expect.objectContaining({
          userId: 'manager-1',
          type: NotificationType.REQUEST_APPROVED,
          link: '/manager/demandes',
        }),
      ]),
    });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-1',
      prisma,
    );
    expect(emailService.sendMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'employee@upowa.org' }),
        expect.objectContaining({ to: 'manager@upowa.org' }),
      ]),
    );
    expect(result).toEqual({
      id: 'request-1',
      reference: 'DM-2026-001',
      status: LeaveRequestStatus.APPROVED,
    });
  });

  it('rejects non-RH users from deciding requests', async () => {
    const { prisma, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue({
      ...rhUser,
      roles: [{ role: RoleType.EMPLOYE }],
    });

    await expect(
      service.decideRequest('request-1', {
        rhId: 'employee-1',
        decision: 'approve',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses RH decisions before manager validation', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ...request,
      status: LeaveRequestStatus.PENDING,
    });

    await expect(
      service.decideRequest('request-1', {
        rhId: rhUser.id,
        decision: 'reject',
        comment: 'Hors process',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-rejects overdue RH review requests before building the summary', async () => {
    const { prisma, emailService, leaveBalanceSync, service } = createHarness();
    const overdueRequest = {
      ...request,
      id: 'request-overdue',
      reference: 'DM-2026-OLD',
    };
    prisma.leaveRequest.findMany
      .mockResolvedValueOnce([overdueRequest])
      .mockResolvedValueOnce([]);
    prisma.user.findMany
      .mockResolvedValueOnce([{ email: 'employee@upowa.org' }])
      .mockResolvedValueOnce([]);

    const result = await service.findSummary({ year: '2026' });

    expect(prisma.validation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-overdue',
        validatorId: rhUser.id,
        level: 3,
        decision: ValidationDecision.REJECTED,
        comment: 'Refus automatique RH apres 7 jour(s) sans decision.',
      }),
    });
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-overdue' },
      data: expect.objectContaining({ status: LeaveRequestStatus.REJECTED }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.REJECT,
        entity: 'LeaveRequest',
        entityId: 'request-overdue',
        metadata: expect.objectContaining({ source: 'rh-auto' }),
      }),
    });
    expect(leaveBalanceSync.syncForRequest).toHaveBeenCalledWith(
      'request-overdue',
      prisma,
    );
    expect(emailService.sendMany).toHaveBeenCalledWith([
      expect.objectContaining({ to: 'employee@upowa.org' }),
    ]);
    expect(result.totals.employees).toBe(0);
  });
});
