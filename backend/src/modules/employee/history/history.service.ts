import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveRequestStatus,
  Prisma,
  UserStatus,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FindEmployeeHistoryQueryDto } from './dto/employee-history.dto';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import { overlapDateWhere, resolveDateRange } from '../../../common/date-range';

const historyRequestSelect = {
  id: true,
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  status: true,
  submittedAt: true,
  createdAt: true,
  owner: { select: { nom: true, prenom: true } },
  leaveType: { select: { code: true, name: true } },
  validations: {
    orderBy: { decidedAt: 'desc' },
    select: {
      decision: true,
      comment: true,
      decidedAt: true,
      validator: { select: { nom: true, prenom: true } },
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type HistoryRequest = Prisma.LeaveRequestGetPayload<{
  select: typeof historyRequestSelect;
}>;

@Injectable()
export class EmployeeHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findAll(query: FindEmployeeHistoryQueryDto) {
    const user = await this.resolveUser(query.userId, query.userEmail);
    const range = resolveDateRange(query, { defaultMode: 'year' });
    const year = range.year;

    await this.leaveBalanceSync.syncUserYear(user.id, year);

    const [requests, balances] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: {
          ownerId: user.id,
          ...overlapDateWhere(range),
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        select: historyRequestSelect,
      }),
      this.prisma.leaveBalance.findMany({
        where: { userId: user.id, year },
        select: { acquired: true, carryover: true, taken: true },
      }),
    ]);

    const rows = requests.map((request) => this.toRow(request));
    const entitlement = this.roundDays(
      balances.reduce(
        (sum, balance) => sum + balance.acquired + balance.carryover,
        0,
      ),
    );
    const taken = this.roundDays(
      balances.reduce((sum, balance) => sum + balance.taken, 0),
    );

    return {
      year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      user: {
        id: user.id,
        email: user.email,
        name: this.fullName(user),
        matricule: user.matricule,
      },
      rows,
      stats: {
        total: rows.length,
        valid: rows.filter((row) => row.status === 'valid').length,
        rejected: rows.filter((row) => row.status === 'rejected').length,
        pending: rows.filter((row) => row.status === 'pending').length,
        daysTaken: taken,
        entitlement,
      },
    };
  }

  private async resolveUser(userId?: string, userEmail?: string) {
    const where = userId?.trim()
      ? { id: userId.trim() }
      : userEmail?.trim()
        ? { email: userEmail.trim().toLowerCase() }
        : null;

    if (!where) throw new BadRequestException('Utilisateur requis');

    const user = await this.prisma.user.findUnique({
      where,
      select: {
        id: true,
        email: true,
        matricule: true,
        nom: true,
        prenom: true,
        status: true,
      },
    });

    if (!user || user.status === UserStatus.INACTIVE) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    return user;
  }

  private toRow(request: HistoryRequest) {
    const status = this.toStatus(request.status);
    const latestValidation = request.validations[0];

    return {
      id: request.id,
      reference: request.reference,
      date: this.formatDate(request.submittedAt ?? request.createdAt),
      requestedBy: this.fullName(request.owner),
      requestedAt: (request.submittedAt ?? request.createdAt).toISOString(),
      type: request.leaveType.name,
      period: `${this.formatDate(request.startDate)} → ${this.formatDate(request.endDate)}`,
      days: this.roundDays(request.days),
      status: status.tone,
      statusLabel: status.label,
      validator: latestValidation?.validator
        ? this.fullName(latestValidation.validator)
        : '—',
      decision: latestValidation
        ? this.toDecision(latestValidation.decision)
        : status.label,
      validatedAt: latestValidation?.decidedAt?.toISOString() ?? null,
      note: latestValidation?.comment?.trim() || '—',
    };
  }

  private toStatus(status: LeaveRequestStatus) {
    const map: Record<
      LeaveRequestStatus,
      {
        tone: 'valid' | 'pending' | 'rejected' | 'draft' | 'neutral';
        label: string;
      }
    > = {
      [LeaveRequestStatus.DRAFT]: { tone: 'draft', label: 'Brouillon' },
      [LeaveRequestStatus.PENDING]: {
        tone: 'pending',
        label: 'En attente manager',
      },
      [LeaveRequestStatus.IN_REVIEW]: {
        tone: 'valid',
        label: 'Validée manager',
      },
      [LeaveRequestStatus.APPROVED]: { tone: 'valid', label: 'Confirmée RH' },
      [LeaveRequestStatus.REJECTED]: { tone: 'rejected', label: 'Refusée' },
      [LeaveRequestStatus.CANCELLED]: { tone: 'neutral', label: 'Annulée' },
    };

    return map[status];
  }

  private toDecision(decision: ValidationDecision) {
    const map: Record<ValidationDecision, string> = {
      [ValidationDecision.APPROVED]: 'Validée',
      [ValidationDecision.REJECTED]: 'Refusée',
      [ValidationDecision.REVIEW_REQUESTED]: 'À revoir',
    };

    return map[decision];
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
