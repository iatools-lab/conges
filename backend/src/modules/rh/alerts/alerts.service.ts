import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ConflictSeverity,
  ConflictStatus,
  LeaveRequestStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RhAlertSeverity,
  RhAlertStatus,
  UpdateRhAlertRuleDto,
  UpdateRhAlertStatusDto,
} from './dto/rh-alerts.dto';
import { LeaveBalanceSyncService } from '../../shared/leave-balances/leave-balance-sync.service';
import {
  fieldDateWhere,
  overlapDateWhere,
  resolveDateRange,
  type ResolvedDateRange,
} from '../../../common/date-range';

type RhAlertRule = {
  id: string;
  rule: string;
  severity: RhAlertSeverity;
  threshold: string;
  enabled: boolean;
};

type RhAlert = {
  id: string;
  severity: RhAlertSeverity;
  status: RhAlertStatus;
  title: string;
  employee: string;
  detail: string;
  detectedDays: number;
  rule: string;
};

type AlertState = Record<string, RhAlertStatus>;

const RULES_SETTING_KEY = 'rh.alert-rules';
const ALERT_STATE_SETTING_KEY = 'rh.alert-state';

const DEFAULT_RULES: RhAlertRule[] = [
  {
    id: 'balance-cap',
    rule: 'Plafond légal CP',
    severity: 'high',
    threshold: '30 jours',
    enabled: true,
  },
  {
    id: 'missing-planning',
    rule: 'Planning annuel',
    severity: 'medium',
    threshold: '0 jour planifié',
    enabled: true,
  },
  {
    id: 'pending-validation',
    rule: 'Validation en attente',
    severity: 'medium',
    threshold: 'Demandes à traiter',
    enabled: true,
  },
  {
    id: 'absence-conflict',
    rule: "Conflit d'absence",
    severity: 'high',
    threshold: 'Conflit actif',
    enabled: true,
  },
  {
    id: 'pending-event',
    rule: 'Événement RH',
    severity: 'medium',
    threshold: 'Non traité',
    enabled: true,
  },
  {
    id: 'balance-missing',
    rule: 'Solde non initialisé',
    severity: 'low',
    threshold: 'Aucun solde annuel',
    enabled: true,
  },
];

@Injectable()
export class RhAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaveBalanceSync: LeaveBalanceSyncService,
  ) {}

  async findAll(filters: {
    severity?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    year?: string;
  }) {
    const range = resolveDateRange(filters, { defaultMode: 'year' });
    await this.leaveBalanceSync.syncYear(range.year);

    const [rules, alertState] = await Promise.all([
      this.getRules(),
      this.getAlertState(),
    ]);
    const alerts = this.applyFilters(
      await this.buildAlerts(rules, alertState, range),
      filters,
    );

    return {
      year: range.year,
      dateFrom: range.dateFromIso,
      dateTo: range.dateToIso,
      stats: {
        active: alerts.filter((alert) => alert.status === 'active').length,
        high: alerts.filter(
          (alert) => alert.status === 'active' && alert.severity === 'high',
        ).length,
        medium: alerts.filter(
          (alert) => alert.status === 'active' && alert.severity === 'medium',
        ).length,
        resolved: alerts.filter((alert) => alert.status === 'resolved').length,
      },
      alerts,
      rules,
    };
  }

  async updateAlertStatus(id: string, dto: UpdateRhAlertStatusDto) {
    const alertState = await this.getAlertState();
    alertState[id] = dto.status;
    await this.saveJsonSetting(ALERT_STATE_SETTING_KEY, alertState);

    return { id, status: dto.status };
  }

  async updateRule(id: string, dto: UpdateRhAlertRuleDto) {
    const rules = await this.getRules();
    const index = rules.findIndex((rule) => rule.id === id);
    if (index === -1) throw new NotFoundException('Règle introuvable');

    rules[index] = {
      ...rules[index],
      rule: dto.rule?.trim() || rules[index].rule,
      severity: dto.severity ?? rules[index].severity,
      threshold: dto.threshold?.trim() || rules[index].threshold,
      enabled: dto.enabled ?? rules[index].enabled,
    };
    await this.saveJsonSetting(RULES_SETTING_KEY, rules);

    return rules[index];
  }

  private async buildAlerts(
    rules: RhAlertRule[],
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const enabledRules = new Map(
      rules.filter((rule) => rule.enabled).map((rule) => [rule.id, rule]),
    );
    const alerts: RhAlert[] = [];

    if (
      enabledRules.has('balance-cap') ||
      enabledRules.has('balance-missing')
    ) {
      alerts.push(
        ...(await this.buildBalanceAlerts(enabledRules, alertState, range)),
      );
    }
    if (enabledRules.has('missing-planning')) {
      alerts.push(
        ...(await this.buildMissingPlanningAlerts(
          enabledRules,
          alertState,
          range,
        )),
      );
    }
    if (enabledRules.has('pending-validation')) {
      alerts.push(
        ...(await this.buildPendingValidationAlerts(
          enabledRules,
          alertState,
          range,
        )),
      );
    }
    if (enabledRules.has('absence-conflict')) {
      alerts.push(
        ...(await this.buildConflictAlerts(enabledRules, alertState, range)),
      );
    }
    if (enabledRules.has('pending-event')) {
      alerts.push(
        ...(await this.buildPendingEventAlerts(
          enabledRules,
          alertState,
          range,
        )),
      );
    }

    return alerts.sort((first, second) => {
      const severityRank = { high: 0, medium: 1, low: 2 };
      return (
        severityRank[first.severity] - severityRank[second.severity] ||
        first.detectedDays - second.detectedDays
      );
    });
  }

  private async buildBalanceAlerts(
    rules: Map<string, RhAlertRule>,
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const year = range.year;
    const users = await this.prisma.user.findMany({
      where: { status: { not: UserStatus.INACTIVE } },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      select: {
        id: true,
        nom: true,
        prenom: true,
        updatedAt: true,
        balances: {
          where: { year },
          select: {
            acquired: true,
            carryover: true,
            taken: true,
            scheduled: true,
          },
        },
      },
    });
    const alerts: RhAlert[] = [];

    for (const user of users) {
      const total = user.balances.reduce(
        (sum, balance) => sum + balance.acquired + balance.carryover,
        0,
      );
      const used = user.balances.reduce(
        (sum, balance) => sum + balance.taken + balance.scheduled,
        0,
      );
      const remaining = Math.round((total - used) * 10) / 10;

      if (rules.has('balance-cap') && remaining > 30) {
        const rule = rules.get('balance-cap')!;
        alerts.push(
          this.withState(
            {
              id: `balance-cap:${user.id}:${year}`,
              severity: rule.severity,
              status: 'active',
              title: 'Solde CP dépassant 30 jours',
              employee: this.fullName(user),
              detail: `Solde restant ${remaining}j - risque de passif élevé.`,
              detectedDays: this.daysSince(user.updatedAt),
              rule: rule.rule,
            },
            alertState,
          ),
        );
      }

      if (rules.has('balance-missing') && user.balances.length === 0) {
        const rule = rules.get('balance-missing')!;
        alerts.push(
          this.withState(
            {
              id: `balance-missing:${user.id}:${year}`,
              severity: rule.severity,
              status: 'active',
              title: 'Solde annuel non initialisé',
              employee: this.fullName(user),
              detail: `Aucun solde ${year} trouvé pour cet employé.`,
              detectedDays: this.daysSince(user.updatedAt),
              rule: rule.rule,
            },
            alertState,
          ),
        );
      }
    }

    return alerts;
  }

  private async buildMissingPlanningAlerts(
    rules: Map<string, RhAlertRule>,
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const year = range.year;
    const rule = rules.get('missing-planning')!;
    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        NOT: { balances: { some: { year, scheduled: { gt: 0 } } } },
      },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
      select: { id: true, nom: true, prenom: true, updatedAt: true },
    });

    return users.map((user) =>
      this.withState(
        {
          id: `missing-planning:${user.id}:${year}`,
          severity: rule.severity,
          status: 'active',
          title: 'Planning annuel manquant',
          employee: this.fullName(user),
          detail: `Aucun jour planifié sur ${year}.`,
          detectedDays: this.daysSince(user.updatedAt),
          rule: rule.rule,
        },
        alertState,
      ),
    );
  }

  private async buildPendingValidationAlerts(
    rules: Map<string, RhAlertRule>,
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const rule = rules.get('pending-validation')!;
    const requests = await this.prisma.leaveRequest.findMany({
      where: {
        status: {
          in: [LeaveRequestStatus.PENDING, LeaveRequestStatus.IN_REVIEW],
        },
        ...overlapDateWhere(range),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        reference: true,
        createdAt: true,
        owner: { select: { nom: true, prenom: true } },
      },
    });

    return requests.map((request) =>
      this.withState(
        {
          id: `pending-validation:${request.id}`,
          severity: rule.severity,
          status: 'active',
          title: 'Demande en attente de validation',
          employee: this.fullName(request.owner),
          detail: `La demande ${request.reference} attend une décision.`,
          detectedDays: this.daysSince(request.createdAt),
          rule: rule.rule,
        },
        alertState,
      ),
    );
  }

  private async buildConflictAlerts(
    rules: Map<string, RhAlertRule>,
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const rule = rules.get('absence-conflict')!;
    const conflicts = await this.prisma.conflict.findMany({
      where: {
        status: ConflictStatus.ACTIVE,
        ...(range.endExclusive
          ? { periodStart: { lt: range.endExclusive } }
          : {}),
        ...(range.dateFrom ? { periodEnd: { gte: range.dateFrom } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        reason: true,
        severity: true,
        createdAt: true,
        request: { select: { owner: { select: { nom: true, prenom: true } } } },
      },
    });

    return conflicts.map((conflict) =>
      this.withState(
        {
          id: `absence-conflict:${conflict.id}`,
          severity: this.toAlertSeverity(conflict.severity, rule.severity),
          status: 'active',
          title: "Conflit d'absence actif",
          employee: this.fullName(conflict.request?.owner) || 'Périmètre RH',
          detail: conflict.reason,
          detectedDays: this.daysSince(conflict.createdAt),
          rule: rule.rule,
        },
        alertState,
      ),
    );
  }

  private async buildPendingEventAlerts(
    rules: Map<string, RhAlertRule>,
    alertState: AlertState,
    range: ResolvedDateRange,
  ) {
    const rule = rules.get('pending-event')!;
    const eventDate = fieldDateWhere(range);
    const events = await this.prisma.event.findMany({
      where: { processed: false, ...(eventDate ? { eventDate } : {}) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        eventDate: true,
        createdAt: true,
        user: { select: { nom: true, prenom: true } },
      },
    });

    return events.map((event) =>
      this.withState(
        {
          id: `pending-event:${event.id}`,
          severity: rule.severity,
          status: 'active',
          title: 'Événement RH à traiter',
          employee: this.fullName(event.user),
          detail: `${event.type} du ${new Intl.DateTimeFormat('fr-FR').format(event.eventDate)} à vérifier.`,
          detectedDays: this.daysSince(event.createdAt),
          rule: rule.rule,
        },
        alertState,
      ),
    );
  }

  private applyFilters(
    alerts: RhAlert[],
    filters: { severity?: string; status?: string },
  ) {
    return alerts.filter((alert) => {
      const severityMatches =
        !filters.severity ||
        filters.severity === 'ALL' ||
        alert.severity === filters.severity;
      const statusMatches =
        !filters.status ||
        filters.status === 'ALL' ||
        alert.status === filters.status;

      return severityMatches && statusMatches;
    });
  }

  private withState(alert: RhAlert, alertState: AlertState) {
    return { ...alert, status: alertState[alert.id] ?? alert.status };
  }

  private async getRules() {
    const configuredRules = await this.readJsonSetting<RhAlertRule[]>(
      RULES_SETTING_KEY,
      DEFAULT_RULES,
    );
    const rulesById = new Map(configuredRules.map((rule) => [rule.id, rule]));

    return DEFAULT_RULES.map((rule) => ({
      ...rule,
      ...rulesById.get(rule.id),
    }));
  }

  private async getAlertState() {
    return this.readJsonSetting<AlertState>(ALERT_STATE_SETTING_KEY, {});
  }

  private async readJsonSetting<T>(key: string, fallback: T): Promise<T> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!setting) return fallback;

    try {
      return JSON.parse(setting.value) as T;
    } catch {
      return fallback;
    }
  }

  private async saveJsonSetting(key: string, value: unknown) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value: JSON.stringify(value),
        category: 'rh-alerts',
        description: 'Configuration des alertes RH',
      },
      update: { value: JSON.stringify(value), category: 'rh-alerts' },
    });
  }

  private toAlertSeverity(
    severity: ConflictSeverity,
    fallback: RhAlertSeverity,
  ) {
    const severityMap: Record<ConflictSeverity, RhAlertSeverity> = {
      [ConflictSeverity.HIGH]: 'high',
      [ConflictSeverity.MEDIUM]: 'medium',
      [ConflictSeverity.LOW]: 'low',
    };

    return severityMap[severity] ?? fallback;
  }

  private fullName(user?: { nom: string; prenom: string } | null) {
    if (!user) return '';
    return `${user.prenom} ${user.nom}`.trim();
  }

  private daysSince(date: Date) {
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    return Math.max(days, 0);
  }
}
