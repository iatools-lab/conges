import {
  LeaveCategory,
  LeaveRequestStatus,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { EmployeePlanningService } from './planning.service';

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    leaveRequest: {
      findMany: jest.fn(),
    },
    leaveType: {
      findMany: jest.fn(),
    },
    event: {
      count: jest.fn(),
    },
  } as any;

  prisma.user.findUnique.mockResolvedValue({
    id: 'employee-1',
    email: 'employee@upowa.org',
    matricule: 'EMP001',
    nom: 'Employee',
    prenom: 'Test',
    status: UserStatus.ACTIVE,
    department: {
      id: 'dept-1',
      code: 'OPS',
      name: 'Ops',
      manager: { id: 'manager-1', nom: 'Manager', prenom: 'Test' },
    },
  });
  prisma.leaveType.findMany.mockResolvedValue([
    {
      id: 'type-1',
      code: 'CP',
      name: 'Congé payé',
      category: LeaveCategory.CONGE_PAYE,
    },
  ]);
  prisma.event.count.mockResolvedValue(0);

  return { prisma, service: new EmployeePlanningService(prisma) };
}

function request(
  status: LeaveRequestStatus,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `request-${status}`,
    reference: `DM-${status}`,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-03T00:00:00.000Z'),
    days: 3,
    status,
    submittedAt: null,
    reason: null,
    leaveType: {
      code: 'CP',
      name: 'Congé payé',
      category: LeaveCategory.CONGE_PAYE,
    },
    validations: [],
    ...overrides,
  };
}

describe('EmployeePlanningService', () => {
  it('projects planned drafts, review drafts, and RH review with correct labels/actions', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findMany.mockResolvedValue([
      request(LeaveRequestStatus.DRAFT),
      request(LeaveRequestStatus.DRAFT, {
        id: 'request-review',
        submittedAt: new Date('2026-05-29T09:00:00.000Z'),
        validations: [{ decision: ValidationDecision.REVIEW_REQUESTED }],
      }),
      request(LeaveRequestStatus.IN_REVIEW),
    ]);

    const result = await service.findYear({ userId: 'employee-1', year: 2026 });

    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: LeaveRequestStatus.CANCELLED },
        }),
      }),
    );
    expect(result.plans[0]).toEqual(
      expect.objectContaining({
        status: 'planned',
        label: 'Planifié',
        canSubmit: true,
        canCancel: true,
        canDelete: true,
      }),
    );
    expect(result.plans[1]).toEqual(
      expect.objectContaining({
        status: 'review',
        label: 'En revue',
        canSubmit: false,
        canCancel: false,
        canDelete: false,
      }),
    );
    expect(result.plans[2]).toEqual(
      expect.objectContaining({
        status: 'review',
        label: 'En revue RH',
        canSubmit: false,
        canCancel: false,
        canDelete: false,
      }),
    );
    expect(result.stats.draft).toBe(1);
  });
});
