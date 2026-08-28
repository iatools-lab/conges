import { BadRequestException } from '@nestjs/common';
import { LeaveRequestStatus, RoleType, UserStatus } from '@prisma/client';
import { PermissionRequestsService } from './permission-requests.service';

const manager = {
  id: 'manager-1',
  email: 'manager@upowa.test',
  nom: 'Manager',
  prenom: 'Mona',
  status: UserStatus.ACTIVE,
  department: { id: 'dep-1', code: 'OPS', name: 'Operations' },
  managedDepartments: [],
  roles: [{ role: RoleType.MANAGER }],
};

const employee = {
  id: 'employee-1',
  email: 'employee@upowa.test',
  matricule: 'EMP001',
  nom: 'Employee',
  prenom: 'Eric',
  status: UserStatus.ACTIVE,
  n1Id: manager.id,
  n1: {
    id: manager.id,
    email: manager.email,
    nom: manager.nom,
    prenom: manager.prenom,
    poste: 'Manager',
  },
  department: {
    id: 'dep-1',
    code: 'OPS',
    name: 'Operations',
    managerId: manager.id,
  },
};

const permissionRow = {
  id: 'permission-1',
  reference: 'PERM-2026-0001',
  ownerId: employee.id,
  permissionDate: new Date('2026-05-12T00:00:00.000Z'),
  reason: 'Rendez-vous administratif',
  status: LeaveRequestStatus.PENDING,
  submittedAt: new Date('2026-05-01T09:00:00.000Z'),
  managerComment: null,
  managerDecidedAt: null,
  rhComment: null,
  rhDecidedAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-05-01T09:00:00.000Z'),
  owner: employee,
  managerValidator: null,
  rhValidator: null,
};

function createHarness() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    permissionRequest: {
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
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

  return {
    prisma,
    emailService,
    service: new PermissionRequestsService(prisma, emailService),
  };
}

describe('PermissionRequestsService', () => {
  it('blocks a new permission when the employee already reached the annual quota', async () => {
    const { prisma, service } = createHarness();
    prisma.user.findUnique.mockResolvedValue(employee);
    prisma.permissionRequest.count.mockResolvedValue(5);
    prisma.permissionRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.createEmployee({
        userId: employee.id,
        userEmail: employee.email,
        permissionDate: '2026-05-12',
        reason: 'Rendez-vous administratif',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.permissionRequest.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('moves a pending permission to RH review after N+1 approval', async () => {
    const { prisma, emailService, service } = createHarness();
    const approvedByManager = {
      ...permissionRow,
      status: LeaveRequestStatus.IN_REVIEW,
      managerValidator: {
        id: manager.id,
        email: manager.email,
        nom: manager.nom,
        prenom: manager.prenom,
      },
      managerDecidedAt: new Date('2026-05-02T10:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue(manager);
    prisma.permissionRequest.findUnique.mockResolvedValue(permissionRow);
    prisma.permissionRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.permissionRequest.findUniqueOrThrow.mockResolvedValue(
      approvedByManager,
    );
    prisma.user.findMany.mockResolvedValue([
      { id: 'rh-1', email: 'rh@upowa.test' },
    ]);

    const result = await service.decideManager(permissionRow.id, {
      managerId: manager.id,
      managerEmail: manager.email,
      decision: 'approve',
    });

    expect(result.statusCode).toBe(LeaveRequestStatus.IN_REVIEW);
    expect(prisma.permissionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: permissionRow.id, status: LeaveRequestStatus.PENDING },
        data: expect.objectContaining({
          status: LeaveRequestStatus.IN_REVIEW,
          managerValidatorId: manager.id,
        }),
      }),
    );
    expect(prisma.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: employee.id }),
          expect.objectContaining({ userId: 'rh-1' }),
        ]),
      }),
    );
    expect(emailService.sendMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: employee.email }),
        expect.objectContaining({ to: 'rh@upowa.test' }),
      ]),
    );
  });
});
