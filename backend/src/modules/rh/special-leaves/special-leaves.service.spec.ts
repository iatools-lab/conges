import {
  LeaveCategory,
  LeaveRequestStatus,
  Sexe,
  UserStatus,
} from '@prisma/client';
import { RhSpecialLeavesService } from './special-leaves.service';

const employee = {
  id: 'employee-1',
  matricule: 'EMP001',
  nom: 'Employee',
  prenom: 'Test',
  sexe: Sexe.M,
  status: UserStatus.ACTIVE,
  dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
  passifInitial: 0,
  children: [],
  events: [],
};

const specialType = {
  id: 'type-spe',
  code: 'SPE',
  name: 'Conge special',
  category: LeaveCategory.CONGE_SPECIAL,
  defaultDays: 12,
  active: true,
};

const paternityType = {
  id: 'type-pat',
  code: 'PAT',
  name: 'Conge paternite',
  category: LeaveCategory.CONGE_PATERNITE,
  defaultDays: 3,
  active: true,
};

const maternityType = {
  id: 'type-mat',
  code: 'MAT',
  name: 'Conge maternite',
  category: LeaveCategory.CONGE_MATERNITE,
  defaultDays: 90,
  active: true,
};

const childType = {
  id: 'type-enf',
  code: 'ENF',
  name: 'Conge enfant',
  category: LeaveCategory.CONGE_PAYE,
  defaultDays: 2,
  active: true,
};

const typesById = new Map(
  [specialType, paternityType, maternityType, childType].map((type) => [
    type.id,
    type,
  ]),
);
const typesByCode = new Map(
  [specialType, paternityType, maternityType, childType].map((type) => [
    type.code,
    type,
  ]),
);

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    leaveType: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    publicHoliday: {
      findMany: jest.fn(),
    },
    leaveRequest: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    leaveBalance: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    event: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    child: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  } as any;

  prisma.user.findUnique.mockResolvedValue(employee);
  prisma.leaveType.findUnique.mockImplementation(({ where }: any) => {
    if (where.id) return Promise.resolve(typesById.get(where.id) ?? null);
    if (where.code) return Promise.resolve(typesByCode.get(where.code) ?? null);
    return Promise.resolve(null);
  });
  prisma.leaveType.findFirst.mockResolvedValue(specialType);
  prisma.leaveType.findMany.mockResolvedValue([
    paternityType,
    maternityType,
    childType,
  ]);
  prisma.publicHoliday.findMany.mockResolvedValue([]);
  prisma.leaveRequest.count.mockResolvedValue(0);
  prisma.leaveRequest.findFirst.mockResolvedValue(null);
  prisma.leaveRequest.findMany.mockResolvedValue([]);
  prisma.leaveRequest.aggregate.mockResolvedValue({ _sum: { days: 0 } });
  prisma.leaveBalance.upsert.mockResolvedValue({});
  prisma.event.findFirst.mockResolvedValue(null);
  prisma.event.create.mockResolvedValue({ id: 'event-1' });
  prisma.event.update.mockResolvedValue({ id: 'event-1' });
  prisma.child.findFirst.mockResolvedValue({ id: 'child-1' });
  prisma.auditLog.create.mockResolvedValue({});
  prisma.notification.create.mockResolvedValue({});
  prisma.leaveRequest.create.mockImplementation(({ data }: any) => {
    const leaveType = typesById.get(data.leaveTypeId) ?? specialType;
    return Promise.resolve({
      id: 'request-1',
      reference: data.reference,
      ownerId: data.ownerId,
      startDate: data.startDate,
      endDate: data.endDate,
      days: data.days,
      reason: data.reason,
      status: data.status,
      submittedAt: data.submittedAt,
      decidedAt: data.decidedAt,
      cancelledAt: null,
      owner: {
        id: employee.id,
        matricule: employee.matricule,
        nom: employee.nom,
        prenom: employee.prenom,
        department: null,
      },
      leaveType,
      attachments: [],
    });
  });

  const leaveEntitlements = {
    getAcquiredDays: jest.fn().mockReturnValue(3),
  } as any;
  const emailService = {
    send: jest.fn(),
  } as any;

  return {
    prisma,
    service: new RhSpecialLeavesService(
      prisma,
      leaveEntitlements,
      emailService,
    ),
  };
}

describe('RhSpecialLeavesService', () => {
  it('imports a birth row for a male employee as paternity leave with computed days', async () => {
    const { prisma, service } = createHarness();

    const result = await service.importRows({
      rows: [
        {
          matricule: 'EMP001',
          eventLabel: 'Naissance',
          startDate: '2026-08-05',
          status: LeaveRequestStatus.APPROVED,
        },
      ],
    });

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaveTypeId: paternityType.id,
          days: 3,
          startDate: new Date('2026-08-05T00:00:00.000Z'),
          endDate: new Date('2026-08-07T00:00:00.000Z'),
        }),
      }),
    );
    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'BIRTH',
          processed: true,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        imported: 1,
        skipped: 0,
        rows: [
          expect.objectContaining({
            leaveTypeCode: 'PAT',
            eventDate: null,
            days: 3,
            imported: true,
          }),
        ],
      }),
    );
  });

  it('skips an already imported special leave instead of creating a duplicate', async () => {
    const { prisma, service } = createHarness();
    prisma.leaveRequest.findFirst.mockResolvedValueOnce({
      id: 'request-existing',
      startDate: new Date('2026-07-10T00:00:00.000Z'),
      endDate: new Date('2026-07-14T00:00:00.000Z'),
      days: 3,
      status: LeaveRequestStatus.APPROVED,
      leaveType: { code: 'SPE' },
    });

    const result = await service.importRows({
      rows: [
        {
          matricule: 'EMP001',
          eventLabel: 'Mariage',
          startDate: '2026-07-10',
        },
      ],
    });

    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        imported: false,
        skippedReason: 'Deja importe',
      }),
    );
  });

  it('keeps a missing imported start date as null and does not create a fake leave request', async () => {
    const { prisma, service } = createHarness();

    const result = await service.importRows({
      rows: [
        {
          matricule: 'EMP001',
          eventLabel: 'Mariage',
          eventDate: '2026-07-10',
          status: LeaveRequestStatus.APPROVED,
        },
      ],
    });

    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        imported: 0,
        skipped: 1,
        rows: [
          expect.objectContaining({
            eventDate: '2026-07-10',
            startDate: null,
            endDate: null,
            days: 0,
            imported: false,
            skippedReason: 'Date debut absente',
          }),
        ],
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            rows: [
              expect.objectContaining({
                eventDate: '2026-07-10',
                startDate: null,
                imported: false,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('puts every employee event in review with a persistent RH comment', async () => {
    const { prisma, service } = createHarness();
    const declaredEvent = {
      id: 'event-1',
      userId: employee.id,
      type: 'MARRIAGE',
      eventDate: new Date('2026-07-10T00:00:00.000Z'),
      description: 'Mariage civil',
      proofUrl: 'data:application/pdf;base64,cHJldXZl',
      processed: false,
      status: LeaveRequestStatus.PENDING,
      rhComment: null,
      reviewedAt: null,
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      user: {
        ...employee,
        email: 'employee@upowa.org',
        department: { name: 'Operations' },
      },
    };
    prisma.event.findUnique.mockResolvedValue(declaredEvent);
    prisma.event.update.mockImplementation(({ data }: any) =>
      Promise.resolve({
        ...declaredEvent,
        ...data,
        user: declaredEvent.user,
      }),
    );

    const result = await service.update('event:event-1', {
      status: LeaveRequestStatus.IN_REVIEW,
      rhComment: 'Merci de préciser la date sur le document.',
      rhId: 'rh-1',
    });

    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processed: false,
          status: LeaveRequestStatus.IN_REVIEW,
          rhComment: 'Merci de préciser la date sur le document.',
        }),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: employee.id,
          link: '/declarer',
        }),
      }),
    );
    expect(result).toMatchObject({
      statusCode: LeaveRequestStatus.IN_REVIEW,
      rhComment: 'Merci de préciser la date sur le document.',
      proofUrl: 'data:application/pdf;base64,cHJldXZl',
    });
  });
});
