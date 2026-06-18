import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, LeaveCategory, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveEntitlementsService } from '../../shared/leave-entitlements/leave-entitlements.service';
import { ImportRhPaidBalancesDto } from './dto/rh-paid-balance-import.dto';

const PAID_LEAVE_CODE = 'CP';

const paidLeaveTypeSelect = {
  id: true,
  code: true,
  name: true,
  category: true,
  defaultDays: true,
} satisfies Prisma.LeaveTypeSelect;

type PaidLeaveType = Prisma.LeaveTypeGetPayload<{
  select: typeof paidLeaveTypeSelect;
}>;

type ImportResultRow = {
  matricule: string;
  employeeId: string;
  employeeName: string;
  acquired: number;
  taken: number;
  scheduled: number;
  previousCarryover: number;
  newCarryover: number;
  importedBalance: number;
  previousRemaining: number;
  newRemaining: number;
};

@Injectable()
export class RhLeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveEntitlements: LeaveEntitlementsService,
  ) {}

  async importPaidBalances(dto: ImportRhPaidBalancesDto) {
    if (!dto.rows.length) {
      throw new BadRequestException('Aucune ligne de solde CP a importer');
    }

    const normalizedRows = dto.rows.map((row, index) => ({
      rowNumber: index + 1,
      matricule: row.matricule.trim(),
      paidBalance: this.roundDays(row.paidBalance),
    }));
    const invalidBalance = normalizedRows.find(
      (row) => !Number.isFinite(row.paidBalance) || row.paidBalance < 0,
    );
    if (invalidBalance) {
      throw new BadRequestException(
        `Solde CP invalide a la ligne ${invalidBalance.rowNumber}`,
      );
    }
    const emptyMatricule = normalizedRows.find((row) => !row.matricule);
    if (emptyMatricule) {
      throw new BadRequestException(
        `Matricule manquant a la ligne ${emptyMatricule.rowNumber}`,
      );
    }

    const matriculeCounts = new Map<string, number>();
    normalizedRows.forEach((row) => {
      const key = row.matricule.toUpperCase();
      matriculeCounts.set(key, (matriculeCounts.get(key) ?? 0) + 1);
    });
    const duplicate = Array.from(matriculeCounts.entries()).find(
      ([, count]) => count > 1,
    );
    if (duplicate) {
      throw new BadRequestException(
        `Matricule en double dans le fichier: ${duplicate[0]}`,
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const leaveType = await this.findPaidLeaveType(transaction);
      const importedRows: ImportResultRow[] = [];

      for (const row of normalizedRows) {
        const employee = await transaction.user.findUnique({
          where: { matricule: row.matricule },
          select: {
            id: true,
            matricule: true,
            nom: true,
            prenom: true,
            sexe: true,
            dateEmbauche: true,
            passifInitial: true,
            status: true,
          },
        });
        if (!employee || employee.status === UserStatus.INACTIVE) {
          throw new NotFoundException(
            `Employe actif introuvable pour le matricule ${row.matricule}`,
          );
        }

        const balance = await transaction.leaveBalance.findUnique({
          where: {
            userId_leaveTypeId_year: {
              userId: employee.id,
              leaveTypeId: leaveType.id,
              year: dto.year,
            },
          },
          select: {
            acquired: true,
            taken: true,
            scheduled: true,
            carryover: true,
          },
        });
        const acquired = this.leaveEntitlements.getAcquiredDays({
          leaveType,
          user: employee,
          year: dto.year,
        });
        const taken = this.roundDays(balance?.taken ?? 0);
        const scheduled = this.roundDays(balance?.scheduled ?? 0);
        const previousCarryover = this.roundDays(balance?.carryover ?? 0);
        const previousRemaining = this.roundDays(
          acquired + previousCarryover - taken - scheduled,
        );
        const newCarryover = this.roundDays(
          row.paidBalance + taken + scheduled - acquired,
        );

        await transaction.leaveBalance.upsert({
          where: {
            userId_leaveTypeId_year: {
              userId: employee.id,
              leaveTypeId: leaveType.id,
              year: dto.year,
            },
          },
          create: {
            userId: employee.id,
            leaveTypeId: leaveType.id,
            year: dto.year,
            acquired,
            carryover: newCarryover,
            taken,
            scheduled,
          },
          update: {
            acquired,
            carryover: newCarryover,
          },
        });

        importedRows.push({
          matricule: employee.matricule,
          employeeId: employee.id,
          employeeName: `${employee.prenom} ${employee.nom}`.trim(),
          acquired,
          taken,
          scheduled,
          previousCarryover,
          newCarryover,
          importedBalance: row.paidBalance,
          previousRemaining,
          newRemaining: this.roundDays(
            acquired + newCarryover - taken - scheduled,
          ),
        });
      }

      await transaction.auditLog.create({
        data: {
          userId: dto.importedById?.trim() || null,
          action: AuditAction.UPDATE,
          entity: 'LeaveBalance',
          metadata: {
            source: 'rh_paid_balance_import',
            year: dto.year,
            leaveTypeCode: PAID_LEAVE_CODE,
            imported: importedRows.length,
            totalImportedBalance: this.roundDays(
              importedRows.reduce((sum, row) => sum + row.importedBalance, 0),
            ),
          },
        },
      });

      return {
        year: dto.year,
        leaveType: {
          id: leaveType.id,
          code: leaveType.code,
          name: leaveType.name,
        },
        imported: importedRows.length,
        totals: {
          importedBalance: this.roundDays(
            importedRows.reduce((sum, row) => sum + row.importedBalance, 0),
          ),
          previousRemaining: this.roundDays(
            importedRows.reduce((sum, row) => sum + row.previousRemaining, 0),
          ),
          newRemaining: this.roundDays(
            importedRows.reduce((sum, row) => sum + row.newRemaining, 0),
          ),
        },
        rows: importedRows,
      };
    });
  }

  private async findPaidLeaveType(client: Prisma.TransactionClient) {
    const leaveType = await client.leaveType.findUnique({
      where: { code: PAID_LEAVE_CODE },
      select: paidLeaveTypeSelect,
    });

    if (!leaveType || leaveType.category !== LeaveCategory.CONGE_PAYE) {
      throw new NotFoundException(
        'Type de conge paye CP introuvable. Initialisez les types de conges dans les parametres RH.',
      );
    }

    return leaveType as PaidLeaveType;
  }

  private roundDays(value: number) {
    return Math.round(Number(value ?? 0) * 10) / 10;
  }
}
