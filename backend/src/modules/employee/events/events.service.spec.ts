import {
  AuditAction,
  EventType,
  NotificationType,
  Sexe,
  UserStatus,
} from '@prisma/client';
import { EmployeeEventsService } from './events.service';

const user = {
  id: 'employee-1',
  email: 'employee@upowa.org',
  matricule: 'EMP001',
  nom: 'Employee',
  prenom: 'Test',
  n1Id: 'manager-1',
  sexe: Sexe.F,
  dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
  passifInitial: 0,
  children: [],
  events: [],
  status: UserStatus.ACTIVE,
};

const event = {
  id: 'event-1',
  type: EventType.BIRTH,
  eventDate: new Date('2026-06-01T00:00:00.000Z'),
  description: 'Acte de naissance',
  proofUrl: 'data:image/png;base64,anVzdGlmaWNhdGlm',
  processed: false,
  createdAt: new Date('2026-06-01T08:00:00.000Z'),
  updatedAt: new Date('2026-06-01T08:00:00.000Z'),
};

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    event: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    leaveType: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    leaveRequest: {
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    leaveBalance: {
      upsert: jest.fn(),
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

  const leaveEntitlements = {
    getAcquiredDays: jest.fn().mockReturnValue(12),
  } as any;

  prisma.user.findUnique.mockResolvedValue(user);
  prisma.user.findMany.mockImplementation(({ where }) => {
    if (where?.roles) {
      return Promise.resolve([{ id: 'rh-1', email: 'rh@upowa.org' }]);
    }
    if (where?.id === 'manager-1') {
      return Promise.resolve([{ id: 'manager-1', email: 'manager@upowa.org' }]);
    }
    return Promise.resolve([]);
  });
  prisma.event.create.mockResolvedValue(event);

  return {
    prisma,
    emailService,
    leaveEntitlements,
    service: new EmployeeEventsService(prisma, emailService, leaveEntitlements),
  };
}

describe('EmployeeEventsService', () => {
  it('keeps event declaration separate from leave requests', async () => {
    const { prisma, emailService, service } = createHarness();
    const proof = {
      originalname: 'justificatif.png',
      mimetype: 'image/png',
      size: 12,
      buffer: Buffer.from('justificatif'),
    };

    await service.create(
      {
        userId: user.id,
        type: EventType.BIRTH,
        eventDate: '2026-06-01',
        description: 'Acte de naissance',
      },
      proof,
    );

    expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.upsert).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'rh-1',
          type: NotificationType.SYSTEM,
          link: '/rh/speciaux',
        }),
      ],
    });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'manager-1',
          type: NotificationType.SYSTEM,
          link: '/manager',
        }),
      ],
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: AuditAction.CREATE,
          entity: 'Event',
          entityId: 'event-1',
        }),
      }),
    );
    expect(emailService.sendMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'rh@upowa.org' }),
        expect.objectContaining({ to: 'manager@upowa.org' }),
      ]),
    );
  });
});
