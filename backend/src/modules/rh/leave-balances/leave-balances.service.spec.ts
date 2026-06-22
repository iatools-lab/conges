import { BadRequestException } from '@nestjs/common';
import { LeaveCategory, Sexe, UserStatus } from '@prisma/client';
import { RhLeaveBalancesService } from './leave-balances.service';

const leaveType = {
  id: 'type-cp',
  code: 'CP',
  name: 'Conges payes',
  category: LeaveCategory.CONGE_PAYE,
  defaultDays: 24,
};

const employee = {
  id: 'employee-1',
  matricule: 'EMP001',
  nom: 'Employee',
  prenom: 'Test',
  sexe: Sexe.M,
  dateEmbauche: new Date('2020-01-01T00:00:00.000Z'),
  passifInitial: 0,
  status: UserStatus.ACTIVE,
};

function createHarness() {
  const prisma = {
    leaveType: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    leaveBalance: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (callback) => callback(prisma)),
  } as any;

  const leaveEntitlements = {
    getAcquiredDays: jest.fn().mockReturnValue(24),
  } as any;

  prisma.leaveType.findUnique.mockResolvedValue(leaveType);
  prisma.user.findUnique.mockResolvedValue(employee);
  prisma.leaveBalance.findUnique.mockResolvedValue({
    acquired: 24,
    taken: 4,
    scheduled: 2,
    carryover: 1,
  });
  prisma.leaveBalance.upsert.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});

  return {
    prisma,
    leaveEntitlements,
    service: new RhLeaveBalancesService(prisma, leaveEntitlements),
  };
}

describe('RhLeaveBalancesService', () => {
  it('imports paid leave balances by adjusting carryover', async () => {
    const { prisma, service } = createHarness();

    const result = await service.importPaidBalances({
      year: 2026,
      importedById: 'rh-1',
      rows: [{ matricule: 'EMP001', paidBalance: 18 }],
    });

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith({
      where: {
        userId_leaveTypeId_year: {
          userId: employee.id,
          leaveTypeId: leaveType.id,
          year: 2026,
        },
      },
      create: expect.any(Object),
      update: {
        acquired: 24,
        carryover: 0,
      },
    });
    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        matricule: 'EMP001',
        previousRemaining: 19,
        importedBalance: 18,
        newCarryover: 0,
        newRemaining: 18,
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'rh-1',
          entity: 'LeaveBalance',
        }),
      }),
    );
  });

  it('creates a missing paid leave balance and preserves imported remaining days', async () => {
    const { prisma, leaveEntitlements, service } = createHarness();
    prisma.leaveBalance.findUnique.mockResolvedValue(null);
    leaveEntitlements.getAcquiredDays.mockReturnValue(24);

    await service.importPaidBalances({
      year: 2026,
      rows: [{ matricule: 'EMP001', paidBalance: 8 }],
    });

    expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acquired: 24,
          carryover: -16,
          taken: 0,
          scheduled: 0,
        }),
        update: {
          acquired: 24,
          carryover: -16,
        },
      }),
    );
  });

  it('rejects duplicate matricules before writing balances', async () => {
    const { prisma, service } = createHarness();

    await expect(
      service.importPaidBalances({
        year: 2026,
        rows: [
          { matricule: 'EMP001', paidBalance: 8 },
          { matricule: 'emp001', paidBalance: 9 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.leaveBalance.upsert).not.toHaveBeenCalled();
  });
});
