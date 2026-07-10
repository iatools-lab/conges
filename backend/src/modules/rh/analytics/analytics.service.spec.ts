import {
  ConflictSeverity,
  ConflictStatus,
  EventType,
  LeaveCategory,
  LeaveRequestStatus,
  Sexe,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { RhAnalyticsService } from './analytics.service';

const department = { id: 'dept-1', code: 'OPS', name: 'Operations' };
const managerLite = { id: 'manager-1', nom: 'Manager', prenom: 'Mona' };
const leaveTypes = {
  cp: { code: 'CP', name: 'Congés payés', category: LeaveCategory.CONGE_PAYE },
  spe: {
    code: 'SPE',
    name: 'Congé spécial',
    category: LeaveCategory.CONGE_SPECIAL,
  },
  mat: {
    code: 'MAT',
    name: 'Congé maternité',
    category: LeaveCategory.CONGE_MATERNITE,
  },
};

function employeeOwner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-1',
    matricule: 'EMP001',
    nom: 'Employee',
    prenom: 'Estelle',
    departmentId: department.id,
    department,
    n1Id: managerLite.id,
    n1: managerLite,
    ...overrides,
  };
}

function createHarness() {
  const users = [
    {
      id: 'manager-1',
      matricule: 'MGR001',
      nom: 'Manager',
      prenom: 'Mona',
      sexe: Sexe.F,
      dateNaissance: new Date('1985-02-10T00:00:00.000Z'),
      dateEmbauche: new Date('2018-01-01T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentId: department.id,
      department,
      n1Id: null,
      n1: null,
      balances: [],
    },
    {
      id: 'employee-1',
      matricule: 'EMP001',
      nom: 'Employee',
      prenom: 'Estelle',
      sexe: Sexe.F,
      dateNaissance: new Date('1994-05-15T00:00:00.000Z'),
      dateEmbauche: new Date('2022-04-01T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentId: department.id,
      department,
      n1Id: managerLite.id,
      n1: managerLite,
      balances: [
        {
          acquired: 24,
          carryover: 2,
          taken: 5,
          scheduled: 4,
          leaveType: leaveTypes.cp,
        },
        {
          acquired: 12,
          carryover: 0,
          taken: 3,
          scheduled: 0,
          leaveType: leaveTypes.spe,
        },
      ],
    },
    {
      id: 'employee-2',
      matricule: 'EMP002',
      nom: 'Sansmanager',
      prenom: 'Sam',
      sexe: Sexe.M,
      dateNaissance: new Date('1998-08-20T00:00:00.000Z'),
      dateEmbauche: new Date('2025-01-01T00:00:00.000Z'),
      status: UserStatus.ACTIVE,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      departmentId: department.id,
      department,
      n1Id: null,
      n1: null,
      balances: [
        {
          acquired: 24,
          carryover: 0,
          taken: 0,
          scheduled: 0,
          leaveType: leaveTypes.cp,
        },
      ],
    },
    {
      id: 'inactive-1',
      matricule: 'OLD001',
      nom: 'Depart',
      prenom: 'Diane',
      sexe: Sexe.F,
      dateNaissance: new Date('1990-01-01T00:00:00.000Z'),
      dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
      status: UserStatus.INACTIVE,
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
      departmentId: department.id,
      department,
      n1Id: null,
      n1: null,
      balances: [],
    },
  ];

  const requests = [
    {
      id: 'request-cp',
      reference: 'CP-001',
      startDate: new Date('2026-02-01T00:00:00.000Z'),
      endDate: new Date('2026-02-05T00:00:00.000Z'),
      days: 5,
      status: LeaveRequestStatus.APPROVED,
      submittedAt: new Date('2026-01-20T00:00:00.000Z'),
      decidedAt: new Date('2026-01-21T00:00:00.000Z'),
      ownerId: 'employee-1',
      owner: employeeOwner(),
      leaveType: leaveTypes.cp,
    },
    {
      id: 'request-spe',
      reference: 'SPE-001',
      startDate: new Date('2026-03-10T00:00:00.000Z'),
      endDate: new Date('2026-03-12T00:00:00.000Z'),
      days: 3,
      status: LeaveRequestStatus.APPROVED,
      submittedAt: new Date('2026-03-01T00:00:00.000Z'),
      decidedAt: new Date('2026-03-02T00:00:00.000Z'),
      ownerId: 'employee-1',
      owner: employeeOwner(),
      leaveType: leaveTypes.spe,
    },
    {
      id: 'request-mat',
      reference: 'MAT-001',
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      endDate: new Date('2026-12-01T00:00:00.000Z'),
      days: 90,
      status: LeaveRequestStatus.APPROVED,
      submittedAt: new Date('2026-06-01T00:00:00.000Z'),
      decidedAt: new Date('2026-06-02T00:00:00.000Z'),
      ownerId: 'employee-1',
      owner: employeeOwner(),
      leaveType: leaveTypes.mat,
    },
  ];

  const prisma = {
    department: {
      findMany: jest.fn().mockResolvedValue([department]),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(users),
    },
    leaveRequest: {
      findMany: jest.fn().mockResolvedValue(requests),
    },
    conflict: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'conflict-1',
          departmentId: department.id,
          severity: ConflictSeverity.HIGH,
          status: ConflictStatus.ACTIVE,
          periodStart: new Date('2026-02-01T00:00:00.000Z'),
          periodEnd: new Date('2026-02-05T00:00:00.000Z'),
          reason: 'Absences simultanées',
        },
      ]),
    },
    event: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'event-1',
          type: EventType.BIRTH,
          eventDate: new Date('2026-04-01T00:00:00.000Z'),
          processed: false,
          user: employeeOwner(),
        },
      ]),
    },
    validation: {
      findMany: jest.fn().mockResolvedValue([
        {
          validatorId: managerLite.id,
          decision: ValidationDecision.APPROVED,
          decidedAt: new Date('2026-01-03T00:00:00.000Z'),
          validator: managerLite,
          request: { submittedAt: new Date('2026-01-01T00:00:00.000Z') },
        },
      ]),
    },
  } as any;

  return { prisma, service: new RhAnalyticsService(prisma) };
}

describe('RhAnalyticsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-08T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates RH analytics for workforce, leaves, alerts and management', async () => {
    const { service } = createHarness();

    const result = await service.findSummary({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });

    expect(result.workforce.totals.activeEmployees).toBe(3);
    expect(result.workforce.turnover).toEqual(
      expect.objectContaining({ inactiveInPeriod: 1, estimatedRate: 25 }),
    );
    expect(result.workforce.employeesWithoutManager).toHaveLength(2);
    expect(result.leaves.takenByDepartment).toEqual([
      expect.objectContaining({ departmentCode: 'OPS', days: 8 }),
    ]);
    expect(result.leaves.specialConsumedByType).toEqual([
      expect.objectContaining({ code: 'SPE', days: 3 }),
    ]);
    expect(result.leaves.maternityOngoingOrPlanned).toEqual([
      expect.objectContaining({ reference: 'MAT-001', days: 90 }),
    ]);
    expect(result.alerts.conflictsByDepartment).toEqual([
      expect.objectContaining({ departmentCode: 'OPS', conflicts: 1, high: 1 }),
    ]);
    expect(result.alerts.unprocessedEvents).toEqual([
      expect.objectContaining({ type: EventType.BIRTH, matricule: 'EMP001' }),
    ]);
    expect(result.management.supervisedCounts).toEqual([
      expect.objectContaining({ managerId: 'manager-1', employees: 1 }),
    ]);
    expect(result.management.averageValidationDelay).toEqual([
      expect.objectContaining({ managerId: 'manager-1', averageHours: 48 }),
    ]);
    expect(result.specialEvents.declaredEvents).toContainEqual({
      type: EventType.BIRTH,
      count: 1,
    });
  });
});
