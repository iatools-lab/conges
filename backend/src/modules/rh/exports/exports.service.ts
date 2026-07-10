import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { GenerateRhExportDto } from './dto/rh-export.dto';
import { fieldDateWhere, resolveDateRange } from '../../../common/date-range';
import {
  getCurrentLeaveYear,
  getLeaveYearRange,
} from '../../../common/leave-year';

type ExportTemplateId =
  | 'monthly-balances'
  | 'leave-journal'
  | 'payroll-variables'
  | 'social-report'
  | 'passive-liability'
  | 'absence-audit';

type ExportTemplate = {
  id: ExportTemplateId;
  name: string;
  description: string;
  format: 'CSV';
  frequency: 'Mensuel' | 'Annuel' | 'À la demande';
};

const EXPORT_TEMPLATES: ExportTemplate[] = [
  {
    id: 'monthly-balances',
    name: 'Soldes mensuels',
    description: 'Soldes CP, RTT et passif par employé',
    format: 'CSV',
    frequency: 'Mensuel',
  },
  {
    id: 'leave-journal',
    name: 'Journal des congés',
    description: 'Tous mouvements de congés sur la période',
    format: 'CSV',
    frequency: 'À la demande',
  },
  {
    id: 'payroll-variables',
    name: 'Paie - Variables',
    description: 'Demandes validées exploitables par la paie',
    format: 'CSV',
    frequency: 'Mensuel',
  },
  {
    id: 'social-report',
    name: 'Bilan social',
    description: 'Indicateurs RH consolidés annuels',
    format: 'CSV',
    frequency: 'Annuel',
  },
  {
    id: 'passive-liability',
    name: 'Passif comptable',
    description: 'Provisions de congés à fin de période',
    format: 'CSV',
    frequency: 'Mensuel',
  },
  {
    id: 'absence-audit',
    name: 'Audit absences',
    description: 'Détail des absences sur 3 ans',
    format: 'CSV',
    frequency: 'À la demande',
  },
];

const leaveRequestExportSelect = {
  reference: true,
  startDate: true,
  endDate: true,
  days: true,
  reason: true,
  status: true,
  owner: {
    select: {
      matricule: true,
      nom: true,
      prenom: true,
      department: { select: { name: true } },
    },
  },
  leaveType: {
    select: {
      code: true,
      name: true,
      category: true,
      paid: true,
    },
  },
} satisfies Prisma.LeaveRequestSelect;

type LeaveRequestExportRecord = Prisma.LeaveRequestGetPayload<{
  select: typeof leaveRequestExportSelect;
}>;

@Injectable()
export class RhExportsService {
  constructor(private readonly prisma: PrismaService) {}

  async findSummary(filters: { dateFrom?: string; dateTo?: string } = {}) {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const range = resolveDateRange(filters, { defaultMode: 'all' });
    const createdAt = fieldDateWhere(range);
    const [exportsThisMonth, exportLogs] = await Promise.all([
      this.prisma.auditLog.count({
        where: {
          action: AuditAction.EXPORT,
          entity: 'RhExport',
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: AuditAction.EXPORT,
          entity: 'RhExport',
          ...(createdAt ? { createdAt } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          entityId: true,
          metadata: true,
          createdAt: true,
          user: { select: { nom: true, prenom: true, email: true } },
        },
      }),
    ]);
    const history = exportLogs.map((log) => this.toHistoryRow(log));

    return {
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      templates: EXPORT_TEMPLATES,
      scheduled: EXPORT_TEMPLATES.filter(
        (template) => template.frequency === 'Mensuel',
      ).map((template) => ({
        templateId: template.id,
        name: template.name,
        frequency: template.frequency,
        status: 'active' as const,
      })),
      history,
      stats: {
        exportsThisMonth,
        scheduledExports: EXPORT_TEMPLATES.filter(
          (template) => template.frequency === 'Mensuel',
        ).length,
        downloads: history.length,
        totalSizeBytes: history.reduce((sum, row) => sum + row.sizeBytes, 0),
      },
    };
  }

  async generate(templateId: string, dto: GenerateRhExportDto) {
    const template = this.getTemplate(templateId);
    const year = dto.year ?? getCurrentLeaveYear();
    const generatedAt = new Date();
    const content = await this.buildExportContent(template.id, year);
    const filename = this.buildFilename(template.id, year, generatedAt);
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const actor = await this.findActor(dto.actorEmail);
    const actorEmail = dto.actorEmail?.trim() || actor?.email;
    const auditLog = await this.prisma.auditLog.create({
      data: {
        userId: actor?.id,
        action: AuditAction.EXPORT,
        entity: 'RhExport',
        entityId: template.id,
        metadata: {
          templateId: template.id,
          templateName: template.name,
          filename,
          format: template.format,
          year,
          sizeBytes,
          actorName: dto.actorName?.trim() || actor?.name || 'RH',
          ...(actorEmail ? { actorEmail } : {}),
        },
      },
      select: { id: true },
    });

    return {
      auditLogId: auditLog.id,
      templateId: template.id,
      filename,
      mimeType: 'text/csv;charset=utf-8',
      content,
      sizeBytes,
      generatedAt: generatedAt.toISOString(),
    };
  }

  private async buildExportContent(templateId: ExportTemplateId, year: number) {
    if (templateId === 'monthly-balances')
      return this.buildMonthlyBalances(year);
    if (templateId === 'leave-journal') return this.buildLeaveJournal(year);
    if (templateId === 'payroll-variables')
      return this.buildPayrollVariables(year);
    if (templateId === 'social-report') return this.buildSocialReport(year);
    if (templateId === 'passive-liability')
      return this.buildPassiveLiability(year);
    return this.buildAbsenceAudit(year);
  }

  private async buildMonthlyBalances(year: number) {
    const balances = await this.prisma.leaveBalance.findMany({
      where: { year },
      orderBy: [{ user: { nom: 'asc' } }, { leaveType: { code: 'asc' } }],
      select: {
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
        user: {
          select: {
            matricule: true,
            nom: true,
            prenom: true,
            department: { select: { name: true } },
          },
        },
        leaveType: { select: { code: true, name: true, category: true } },
      },
    });

    return this.toCsv(
      [
        'Matricule',
        'Employé',
        'Pôle',
        'Code',
        'Type',
        'Catégorie',
        'Acquis',
        'Report',
        'Pris',
        'Planifié',
        'Restant',
      ],
      balances.map((balance) => {
        const total = balance.acquired + balance.carryover;
        return [
          balance.user.matricule,
          this.fullName(balance.user),
          balance.user.department?.name ?? '',
          balance.leaveType.code,
          balance.leaveType.name,
          balance.leaveType.category,
          this.roundDays(balance.acquired),
          this.roundDays(balance.carryover),
          this.roundDays(balance.taken),
          this.roundDays(balance.scheduled),
          this.roundDays(total - balance.taken - balance.scheduled),
        ];
      }),
    );
  }

  private async buildLeaveJournal(year: number) {
    const { yearStart, nextYearStart } = this.getYearRange(year);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        startDate: { lt: nextYearStart },
        endDate: { gte: yearStart },
      },
      orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
      select: leaveRequestExportSelect,
    });

    return this.toCsv(
      [
        'Référence',
        'Matricule',
        'Employé',
        'Pôle',
        'Type',
        'Début',
        'Fin',
        'Jours',
        'Statut',
        'Motif',
      ],
      requests.map((request) => this.toRequestRow(request)),
    );
  }

  private async buildPayrollVariables(year: number) {
    const { yearStart, nextYearStart } = this.getYearRange(year);
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lt: nextYearStart },
        endDate: { gte: yearStart },
      },
      orderBy: [{ owner: { nom: 'asc' } }, { startDate: 'asc' }],
      select: leaveRequestExportSelect,
    });

    return this.toCsv(
      [
        'Matricule',
        'Employé',
        'Code absence',
        'Libellé',
        'Début',
        'Fin',
        'Jours paie',
        'Payé',
      ],
      requests.map((request) => [
        request.owner.matricule,
        this.fullName(request.owner),
        request.leaveType.code,
        request.leaveType.name,
        this.formatDate(request.startDate),
        this.formatDate(request.endDate),
        this.roundDays(request.days),
        request.leaveType.paid ? 'Oui' : 'Non',
      ]),
    );
  }

  private async buildSocialReport(year: number) {
    const { yearStart, nextYearStart } = this.getYearRange(year);
    const departments = await this.prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: {
        name: true,
        employees: { select: { id: true } },
        _count: { select: { employees: true } },
      },
    });
    const requests = await this.prisma.leaveRequest.groupBy({
      by: ['status'],
      where: {
        startDate: { lt: nextYearStart },
        endDate: { gte: yearStart },
      },
      _sum: { days: true },
      _count: { id: true },
    });
    const rows = [
      ...departments.map((department) => [
        'Effectif',
        department.name,
        department._count.employees,
        '',
      ]),
      ...requests.map((request) => [
        'Congés',
        request.status,
        request._count.id,
        this.roundDays(request._sum.days ?? 0),
      ]),
    ];

    return this.toCsv(['Indicateur', 'Libellé', 'Nombre', 'Jours'], rows);
  }

  private async buildPassiveLiability(year: number) {
    const balances = await this.prisma.leaveBalance.findMany({
      where: { year, leaveType: { code: 'PASSIF' } },
      orderBy: [{ user: { nom: 'asc' } }],
      select: {
        acquired: true,
        carryover: true,
        taken: true,
        scheduled: true,
        user: {
          select: {
            matricule: true,
            nom: true,
            prenom: true,
            passifInitial: true,
            department: { select: { name: true } },
          },
        },
      },
    });

    return this.toCsv(
      [
        'Matricule',
        'Employé',
        'Pôle',
        'Passif initial',
        'Provision année',
        'Consommé',
        'Restant',
      ],
      balances.map((balance) => {
        const allocated = balance.acquired + balance.carryover;
        const consumed = balance.taken + balance.scheduled;
        return [
          balance.user.matricule,
          this.fullName(balance.user),
          balance.user.department?.name ?? '',
          this.roundDays(balance.user.passifInitial),
          this.roundDays(allocated),
          this.roundDays(consumed),
          this.roundDays(allocated - consumed),
        ];
      }),
    );
  }

  private async buildAbsenceAudit(year: number) {
    const yearStart = this.getYearRange(year - 2).yearStart;
    const nextYearStart = this.getYearRange(year).nextYearStart;
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        startDate: { lt: nextYearStart },
        endDate: { gte: yearStart },
      },
      orderBy: [{ startDate: 'asc' }, { reference: 'asc' }],
      select: leaveRequestExportSelect,
    });

    return this.toCsv(
      [
        'Référence',
        'Matricule',
        'Employé',
        'Pôle',
        'Type',
        'Catégorie',
        'Début',
        'Fin',
        'Jours',
        'Statut',
      ],
      requests.map((request) => [
        request.reference,
        request.owner.matricule,
        this.fullName(request.owner),
        request.owner.department?.name ?? '',
        request.leaveType.name,
        request.leaveType.category,
        this.formatDate(request.startDate),
        this.formatDate(request.endDate),
        this.roundDays(request.days),
        request.status,
      ]),
    );
  }

  private toRequestRow(request: LeaveRequestExportRecord) {
    return [
      request.reference,
      request.owner.matricule,
      this.fullName(request.owner),
      request.owner.department?.name ?? '',
      request.leaveType.name,
      this.formatDate(request.startDate),
      this.formatDate(request.endDate),
      this.roundDays(request.days),
      request.status,
      request.reason ?? '',
    ];
  }

  private toHistoryRow(log: {
    id: string;
    entityId: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    user: { nom: string; prenom: string; email: string } | null;
  }) {
    const metadata = this.asRecord(log.metadata);
    const actorName = this.toText(
      metadata.actorName,
      log.user ? this.fullName(log.user) : 'RH',
    );
    const filename = this.toText(metadata.filename, 'export.csv');
    const templateName = this.toText(
      metadata.templateName,
      log.entityId ?? 'Export',
    );
    const sizeBytes = Number(metadata.sizeBytes ?? 0);

    return {
      id: log.id,
      templateId: log.entityId,
      templateName,
      filename,
      actorName,
      sizeBytes,
      sizeLabel: this.formatSize(sizeBytes),
      generatedAt: log.createdAt.toISOString(),
      generatedAtLabel: new Intl.DateTimeFormat('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(log.createdAt),
    };
  }

  private async findActor(email?: string) {
    if (!email?.trim()) return null;
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, nom: true, prenom: true },
    });
    if (!user) return null;

    return { id: user.id, email: user.email, name: this.fullName(user) };
  }

  private getTemplate(templateId: string) {
    const template = EXPORT_TEMPLATES.find((item) => item.id === templateId);
    if (!template) throw new BadRequestException('Modèle export introuvable');

    return template;
  }

  private buildFilename(
    templateId: ExportTemplateId,
    year: number,
    generatedAt: Date,
  ) {
    const stamp = generatedAt.toISOString().slice(0, 10).replace(/-/g, '');
    return `${templateId}_${year}_${stamp}.csv`;
  }

  private toCsv(headers: string[], rows: unknown[][]) {
    const lines = [headers, ...rows].map((row) =>
      row.map((cell) => this.escapeCsvCell(cell)).join(';'),
    );

    return `\uFEFF${lines.join('\n')}`;
  }

  private escapeCsvCell(value: unknown) {
    const text = this.toText(value, '');
    if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  private toText(value: unknown, fallback: string) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    return fallback;
  }

  private getYearRange(year: number) {
    const range = getLeaveYearRange(year);
    return {
      yearStart: range.start,
      nextYearStart: range.endExclusive,
    };
  }

  private fullName(user: { nom: string; prenom: string }) {
    return `${user.prenom} ${user.nom}`.trim();
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private formatSize(bytes: number) {
    if (bytes >= 1024 * 1024)
      return `${this.roundDays(bytes / 1024 / 1024)} Mo`;
    if (bytes >= 1024) return `${this.roundDays(bytes / 1024)} Ko`;
    return `${bytes} o`;
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }

    return {};
  }

  private roundDays(value: number) {
    return Math.round(value * 10) / 10;
  }
}
