import type { ReactNode } from "react";
import { useState, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

type AnalyticsRow = Record<string, unknown>;
type StatTone = "green" | "blue" | "orange" | "yellow" | "red" | "purple";
type BadgeTone =
  | "valid"
  | "pending"
  | "rejected"
  | "draft"
  | "info"
  | "neutral"
  | "review"
  | "planned";

type AnalyticsResponse = {
  year: number;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  thresholds: {
    absence: number;
    pendingDays: number;
    unplannedDays: number;
  };
  workforce: {
    totals: {
      employees: number;
      activeEmployees: number;
      inactiveEmployees: number;
      departments: number;
      estimatedTurnover: number;
    };
    byDepartment: AnalyticsRow[];
    genderByDepartment: AnalyticsRow[];
    averageAgeByDepartment: AnalyticsRow[];
    averageSeniorityByDepartment: AnalyticsRow[];
    turnover: AnalyticsRow;
    employeesWithoutManager: AnalyticsRow[];
    employeesWithoutAnnualPlanning: AnalyticsRow[];
  };
  leaves: {
    takenByDepartment: AnalyticsRow[];
    plannedByDepartment: AnalyticsRow[];
    specialConsumedByType: AnalyticsRow[];
    paidConsumptionByDepartment: AnalyticsRow[];
    monthlyTakenEvolution: AnalyticsRow[];
    topAbsentees: AnalyticsRow[];
    maternityOngoingOrPlanned: AnalyticsRow[];
    negativeBalances: AnalyticsRow[];
  };
  alerts: {
    conflictsByDepartment: AnalyticsRow[];
    conflictsBySeverity: AnalyticsRow[];
    riskPeriods: AnalyticsRow[];
    pendingRequests: {
      total: number;
      byStatus: AnalyticsRow[];
      rows: AnalyticsRow[];
    };
    unprocessedEvents: AnalyticsRow[];
  };
  trends: {
    monthlyAbsenceRate: AnalyticsRow[];
    busiestMonths: AnalyticsRow[];
    mostUsedLeaveTypes: AnalyticsRow[];
    requestedWeekdays: AnalyticsRow[];
    averageDurationByDepartment: AnalyticsRow[];
  };
  management: {
    supervisedCounts: AnalyticsRow[];
    averageValidationDelay: AnalyticsRow[];
    managersWithPending: AnalyticsRow[];
    approvalRateByManager: AnalyticsRow[];
  };
  balances: {
    lowCpBalance: AnalyticsRow[];
    highCpBalance: AnalyticsRow[];
    unplannedLeave: AnalyticsRow[];
    carryoverByDepartment: AnalyticsRow[];
    employeesWithoutLeaveTaken: AnalyticsRow[];
  };
  specialEvents: {
    declaredEvents: AnalyticsRow[];
    eventsByDepartment: AnalyticsRow[];
    specialConsumedByType: AnalyticsRow[];
    employeesReachedAnnualCap: AnalyticsRow[];
  };
};

type SectionId =
  | "workforce"
  | "leaves"
  | "alerts"
  | "trends"
  | "management"
  | "balances"
  | "specialEvents";

type Column = {
  header: string;
  key?: string;
  align?: "left" | "right" | "center";
  render?: (row: AnalyticsRow) => ReactNode;
};

const sectionCopy: Record<SectionId, { title: string; subtitle: string }> = {
  workforce: {
    title: "Analyse des effectifs",
    subtitle: "Répartition, ancienneté, managers et risques de non-planification.",
  },
  leaves: {
    title: "Analyse des congés",
    subtitle: "Consommation, planification, maternité et soldes négatifs.",
  },
  alerts: {
    title: "Conflits et alertes RH",
    subtitle: "Conflits, périodes à risque, demandes en attente et événements non traités.",
  },
  trends: {
    title: "Tendances et comportements",
    subtitle: "Saisonnalité, habitudes de demande et durée moyenne des absences.",
  },
  management: {
    title: "Analyse managériale N+1",
    subtitle: "Charge d’encadrement, délais et taux d’approbation par manager.",
  },
  balances: {
    title: "Soldes et droits à congés",
    subtitle: "Faibles soldes, soldes élevés, reports et congés non planifiés.",
  },
  specialEvents: {
    title: "Congés spéciaux et événements RH",
    subtitle: "Naissances, mariages, décès et consommation du plafond annuel.",
  },
};

const emptyAnalytics: AnalyticsResponse = {
  year: new Date().getFullYear(),
  dateFrom: "",
  dateTo: "",
  generatedAt: "",
  thresholds: { absence: 0.3, pendingDays: 7, unplannedDays: 5 },
  workforce: {
    totals: {
      employees: 0,
      activeEmployees: 0,
      inactiveEmployees: 0,
      departments: 0,
      estimatedTurnover: 0,
    },
    byDepartment: [],
    genderByDepartment: [],
    averageAgeByDepartment: [],
    averageSeniorityByDepartment: [],
    turnover: {},
    employeesWithoutManager: [],
    employeesWithoutAnnualPlanning: [],
  },
  leaves: {
    takenByDepartment: [],
    plannedByDepartment: [],
    specialConsumedByType: [],
    paidConsumptionByDepartment: [],
    monthlyTakenEvolution: [],
    topAbsentees: [],
    maternityOngoingOrPlanned: [],
    negativeBalances: [],
  },
  alerts: {
    conflictsByDepartment: [],
    conflictsBySeverity: [],
    riskPeriods: [],
    pendingRequests: { total: 0, byStatus: [], rows: [] },
    unprocessedEvents: [],
  },
  trends: {
    monthlyAbsenceRate: [],
    busiestMonths: [],
    mostUsedLeaveTypes: [],
    requestedWeekdays: [],
    averageDurationByDepartment: [],
  },
  management: {
    supervisedCounts: [],
    averageValidationDelay: [],
    managersWithPending: [],
    approvalRateByManager: [],
  },
  balances: {
    lowCpBalance: [],
    highCpBalance: [],
    unplannedLeave: [],
    carryoverByDepartment: [],
    employeesWithoutLeaveTaken: [],
  },
  specialEvents: {
    declaredEvents: [],
    eventsByDepartment: [],
    specialConsumedByType: [],
    employeesReachedAnnualCap: [],
  },
};

function buildAnalyticsPath(range: DateRangeValue) {
  const params = appendDateRange(new URLSearchParams(), range);
  const query = params.toString();
  return query ? `/rh/analytics?${query}` : "/rh/analytics";
}

function formatNumber(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(
    Number.isFinite(number) ? number : 0,
  );
}

function formatPercent(value: unknown) {
  return `${formatNumber(value)} %`;
}

function formatDate(value: unknown) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(
    new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`),
  );
}

function text(row: AnalyticsRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function number(row: AnalyticsRow, key: string, suffix = "") {
  return `${formatNumber(row[key])}${suffix}`;
}

function sumRows(rows: AnalyticsRow[], key: string) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function eventCount(rows: AnalyticsRow[], type: string) {
  return Number(rows.find((row) => row.type === type)?.count ?? 0);
}

function severityTone(value: unknown): BadgeTone {
  if (value === "HIGH") return "rejected";
  if (value === "MEDIUM") return "pending";
  if (value === "LOW") return "valid";
  return "neutral";
}

function statusTone(value: unknown): BadgeTone {
  if (value === "APPROVED" || value === "PROCESSED") return "valid";
  if (value === "REJECTED") return "rejected";
  if (value === "IN_REVIEW") return "review";
  if (value === "PENDING") return "pending";
  if (value === "DRAFT") return "draft";
  return "neutral";
}

function CodeBadge({ value, tone = "neutral" }: { value: unknown; tone?: BadgeTone }) {
  return <Badge tone={tone}>{String(value ?? "-")}</Badge>;
}

// ──────────────────────────────────────────
// Paginated DataTable
// ──────────────────────────────────────────

const PAGE_SIZE = 10;

function PaginationBar({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: ReactNode[] = [];
  const range = 2;
  const start = Math.max(1, currentPage - range);
  const end = Math.min(totalPages, currentPage + range);

  if (start > 1) {
    pages.push(
      <button
        key="first"
        type="button"
        onClick={() => onPageChange(1)}
        className="rounded px-2 py-1 text-xs hover:bg-muted"
      >
        1
      </button>,
    );
    if (start > 2) {
      pages.push(
        <span key="start-ellipsis" className="px-1 text-xs text-muted-foreground">
          …
        </span>,
      );
    }
  }

  for (let i = start; i <= end; i++) {
    pages.push(
      <button
        key={i}
        type="button"
        onClick={() => onPageChange(i)}
        className={`rounded px-2 py-1 text-xs font-medium ${
          i === currentPage
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted text-muted-foreground"
        }`}
      >
        {i}
      </button>,
    );
  }

  if (end < totalPages) {
    if (end < totalPages - 1) {
      pages.push(
        <span key="end-ellipsis" className="px-1 text-xs text-muted-foreground">
          …
        </span>,
      );
    }
    pages.push(
      <button
        key="last"
        type="button"
        onClick={() => onPageChange(totalPages)}
        className="rounded px-2 py-1 text-xs hover:bg-muted"
      >
        {totalPages}
      </button>,
    );
  }

  return (
    <div className="flex items-center justify-between border-t px-5 py-3">
      <span className="text-xs text-muted-foreground">
        {currentPage * PAGE_SIZE - PAGE_SIZE + 1}–
        {Math.min(currentPage * PAGE_SIZE, totalPages * PAGE_SIZE)} sur {totalPages * PAGE_SIZE}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pages}
        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function DataTable({
  title,
  rows,
  columns,
  empty = "Aucune donnée pour la période sélectionnée.",
  pageSize = PAGE_SIZE,
}: {
  title: string;
  rows: AnalyticsRow[];
  columns: Column[];
  empty?: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  const paginatedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  const handlePageChange = useCallback((nextPage: number) => setPage(nextPage), []);

  // Auto-reset si la page courante dépasse le nouveau nombre de pages
  if (page > totalPages && totalPages > 0) {
    setPage(totalPages);
  }

  return (
    <Card>
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`px-5 py-3 ${column.align === "right" ? "text-right" : ""} ${
                    column.align === "center" ? "text-center" : ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginatedRows.map((row, index) => (
              <tr
                key={String(row.id ?? row.reference ?? `${title}-${index}`)}
                className="hover:bg-muted/30"
              >
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={`px-5 py-3 ${column.align === "right" ? "text-right" : ""} ${
                      column.align === "center" ? "text-center" : ""
                    }`}
                  >
                    {column.render ? column.render(row) : column.key ? text(row, column.key) : "-"}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  className="px-5 py-6 text-center text-muted-foreground"
                  colSpan={columns.length}
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
    </Card>
  );
}

function KpiGrid({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; suffix?: string; tone: StatTone; hint?: string }>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value}
          suffix={item.suffix}
          tone={item.tone}
          hint={item.hint}
        />
      ))}
    </div>
  );
}

function SectionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 xl:grid-cols-2">{children}</div>;
}

const departmentColumns: Column[] = [
  {
    header: "Département",
    render: (row) => `${text(row, "departmentName")} (${text(row, "departmentCode")})`,
  },
  { header: "Total", align: "right", render: (row) => number(row, "total") },
  { header: "Actifs", align: "right", render: (row) => number(row, "active") },
  { header: "Inactifs", align: "right", render: (row) => number(row, "inactive") },
  { header: "Hommes", align: "right", render: (row) => number(row, "men") },
  { header: "Femmes", align: "right", render: (row) => number(row, "women") },
];

const employeeColumns: Column[] = [
  { header: "Employé", key: "employee" },
  { header: "Matricule", key: "matricule" },
  { header: "Département", key: "departmentName" },
];

const departmentDaysColumns: Column[] = [
  {
    header: "Département",
    render: (row) => `${text(row, "departmentName")} (${text(row, "departmentCode")})`,
  },
  { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
  { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
];

function WorkforceSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Effectif actif",
            value: formatNumber(data.workforce.totals.activeEmployees),
            tone: "blue",
          },
          {
            label: "Turn-over estimé",
            value: formatPercent(data.workforce.totals.estimatedTurnover),
            tone: "orange",
            hint: "Basé sur les passages à INACTIVE dans la période.",
          },
          {
            label: "Sans manager N+1",
            value: formatNumber(data.workforce.employeesWithoutManager.length),
            tone: "red",
          },
          {
            label: "Sans planning annuel",
            value: formatNumber(data.workforce.employeesWithoutAnnualPlanning.length),
            tone: "yellow",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Effectif par département"
          rows={data.workforce.byDepartment}
          columns={departmentColumns}
        />
        <DataTable
          title="Âge et ancienneté moyens"
          rows={data.workforce.byDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            {
              header: "Âge moyen",
              align: "right",
              render: (row) => number(row, "averageAge", " ans"),
            },
            {
              header: "Ancienneté moyenne",
              align: "right",
              render: (row) => number(row, "averageSeniority", " ans"),
            },
          ]}
        />
        <DataTable
          title="Employés sans manager N+1"
          rows={data.workforce.employeesWithoutManager}
          columns={employeeColumns}
        />
        <DataTable
          title="Employés sans planning annuel"
          rows={data.workforce.employeesWithoutAnnualPlanning}
          columns={[
            ...employeeColumns,
            {
              header: "Reste à planifier",
              align: "right",
              render: (row) => number(row, "remainingToPlan", " j"),
            },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function LeavesSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Jours pris",
            value: formatNumber(sumRows(data.leaves.takenByDepartment, "days")),
            suffix: "jours",
            tone: "green",
          },
          {
            label: "Jours planifiés",
            value: formatNumber(sumRows(data.leaves.plannedByDepartment, "days")),
            suffix: "jours",
            tone: "yellow",
          },
          {
            label: "Congés spéciaux consommés",
            value: formatNumber(sumRows(data.leaves.specialConsumedByType, "days")),
            suffix: "jours",
            tone: "purple",
          },
          {
            label: "Soldes négatifs",
            value: formatNumber(data.leaves.negativeBalances.length),
            tone: "red",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Jours de congé pris par département"
          rows={data.leaves.takenByDepartment}
          columns={departmentDaysColumns}
        />
        <DataTable
          title="Jours planifiés par département"
          rows={data.leaves.plannedByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            {
              header: "Jours planifiés",
              align: "right",
              render: (row) => number(row, "days", " j"),
            },
          ]}
        />
        <DataTable
          title="Taux de consommation des congés payés"
          rows={data.leaves.paidConsumptionByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            { header: "Droits", align: "right", render: (row) => number(row, "acquired", " j") },
            { header: "Pris", align: "right", render: (row) => number(row, "taken", " j") },
            { header: "Taux", align: "right", render: (row) => formatPercent(row.rate) },
          ]}
        />
        <DataTable
          title="Évolution mensuelle des congés pris"
          rows={data.leaves.monthlyTakenEvolution}
          columns={[
            { header: "Mois", key: "label" },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Top 5 des employés les plus absents"
          rows={data.leaves.topAbsentees}
          columns={[
            ...employeeColumns,
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Congés maternité en cours ou planifiés"
          rows={data.leaves.maternityOngoingOrPlanned}
          columns={[
            { header: "Employée", key: "employee" },
            { header: "Référence", key: "reference" },
            { header: "Début", render: (row) => formatDate(row.startDate) },
            { header: "Fin", render: (row) => formatDate(row.endDate) },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            {
              header: "Statut",
              render: (row) => <CodeBadge value={row.status} tone={statusTone(row.status)} />,
            },
          ]}
        />
        <DataTable
          title="Jours de congés spéciaux consommés"
          rows={data.leaves.specialConsumedByType}
          columns={[
            { header: "Code", render: (row) => <CodeBadge value={row.code} tone="info" /> },
            { header: "Type", key: "type" },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Soldes négatifs de congés"
          rows={data.leaves.negativeBalances}
          columns={[
            ...employeeColumns,
            { header: "Type", key: "type" },
            { header: "Solde", align: "right", render: (row) => number(row, "remaining", " j") },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function AlertsSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Conflits actifs",
            value: formatNumber(sumRows(data.alerts.conflictsByDepartment, "conflicts")),
            tone: "red",
          },
          {
            label: "Demandes en attente",
            value: formatNumber(data.alerts.pendingRequests.total),
            tone: "orange",
          },
          {
            label: "Événements non traités",
            value: formatNumber(data.alerts.unprocessedEvents.length),
            tone: "yellow",
          },
          {
            label: "Périodes à risque",
            value: formatNumber(data.alerts.riskPeriods.length),
            tone: "purple",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Conflits d’absence par département"
          rows={data.alerts.conflictsByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            { header: "Conflits", align: "right", render: (row) => number(row, "conflicts") },
            { header: "HIGH", align: "right", render: (row) => number(row, "high") },
            { header: "MEDIUM", align: "right", render: (row) => number(row, "medium") },
            { header: "LOW", align: "right", render: (row) => number(row, "low") },
          ]}
        />
        <DataTable
          title="Conflits par sévérité"
          rows={data.alerts.conflictsBySeverity}
          columns={[
            {
              header: "Sévérité",
              render: (row) => <CodeBadge value={row.severity} tone={severityTone(row.severity)} />,
            },
            { header: "Nombre", align: "right", render: (row) => number(row, "count") },
          ]}
        />
        <DataTable
          title="Périodes à risque"
          rows={data.alerts.riskPeriods}
          columns={[
            { header: "Mois", key: "label" },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Taux", align: "right", render: (row) => formatPercent(row.rate) },
            { header: "Seuil", align: "right", render: (row) => formatPercent(row.threshold) },
          ]}
        />
        <DataTable
          title="Demandes en attente de validation"
          rows={data.alerts.pendingRequests.rows}
          columns={[
            { header: "Employé", key: "employee" },
            { header: "Référence", key: "reference" },
            { header: "Type", key: "type" },
            { header: "Soumise le", render: (row) => formatDate(row.submittedAt) },
            {
              header: "Statut",
              render: (row) => <CodeBadge value={row.status} tone={statusTone(row.status)} />,
            },
          ]}
        />
        <DataTable
          title="Événements RH non traités"
          rows={data.alerts.unprocessedEvents}
          columns={[
            ...employeeColumns,
            { header: "Type", render: (row) => <CodeBadge value={row.type} tone="info" /> },
            { header: "Date événement", render: (row) => formatDate(row.eventDate) },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function TrendsSection({ data }: { data: AnalyticsResponse }) {
  const averageRate =
    data.trends.monthlyAbsenceRate.length > 0
      ? sumRows(data.trends.monthlyAbsenceRate, "rate") / data.trends.monthlyAbsenceRate.length
      : 0;

  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          { label: "Taux d’absence moyen", value: formatPercent(averageRate), tone: "blue" },
          {
            label: "Mois pic",
            value: String(data.trends.busiestMonths[0]?.label ?? "-"),
            tone: "purple",
          },
          {
            label: "Types suivis",
            value: formatNumber(data.trends.mostUsedLeaveTypes.length),
            tone: "green",
          },
          {
            label: "Jours semaine analysés",
            value: formatNumber(data.trends.requestedWeekdays.length),
            tone: "orange",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Taux d’absence mensuel"
          rows={data.trends.monthlyAbsenceRate}
          columns={[
            { header: "Mois", key: "label" },
            {
              header: "Jours absence",
              align: "right",
              render: (row) => number(row, "absenceDays", " j"),
            },
            { header: "Taux", align: "right", render: (row) => formatPercent(row.rate) },
          ]}
        />
        <DataTable
          title="Mois les plus sollicités"
          rows={data.trends.busiestMonths}
          columns={[
            { header: "Mois", key: "label" },
            { header: "Jours", align: "right", render: (row) => number(row, "absenceDays", " j") },
            { header: "Taux", align: "right", render: (row) => formatPercent(row.rate) },
          ]}
        />
        <DataTable
          title="Types de congés les plus utilisés"
          rows={data.trends.mostUsedLeaveTypes}
          columns={[
            { header: "Type", key: "type" },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Jours de semaine les plus demandés"
          rows={data.trends.requestedWeekdays}
          columns={[
            { header: "Jour", key: "label" },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Durée moyenne des congés par département"
          rows={data.trends.averageDurationByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            {
              header: "Durée moyenne",
              align: "right",
              render: (row) => number(row, "averageDays", " j"),
            },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function ManagementSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Managers actifs",
            value: formatNumber(data.management.supervisedCounts.length),
            tone: "blue",
          },
          {
            label: "Collaborateurs supervisés",
            value: formatNumber(sumRows(data.management.supervisedCounts, "employees")),
            tone: "green",
          },
          {
            label: "Managers avec retard",
            value: formatNumber(data.management.managersWithPending.length),
            tone: "red",
          },
          {
            label: "Délai moyen global",
            value: formatNumber(
              data.management.averageValidationDelay.length
                ? sumRows(data.management.averageValidationDelay, "averageHours") /
                    data.management.averageValidationDelay.length
                : 0,
            ),
            suffix: "heures",
            tone: "orange",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Nombre de collaborateurs supervisés"
          rows={data.management.supervisedCounts}
          columns={[
            { header: "Manager", key: "manager" },
            { header: "Collaborateurs", align: "right", render: (row) => number(row, "employees") },
          ]}
        />
        <DataTable
          title="Délai moyen de validation"
          rows={data.management.averageValidationDelay}
          columns={[
            { header: "Manager", key: "manager" },
            {
              header: "Délai moyen",
              align: "right",
              render: (row) => number(row, "averageHours", " h"),
            },
          ]}
        />
        <DataTable
          title="Managers avec dossiers en attente"
          rows={data.management.managersWithPending}
          columns={[
            { header: "Manager", key: "manager" },
            { header: "Dossiers", align: "right", render: (row) => number(row, "pending") },
            { header: "Plus ancienne demande", render: (row) => formatDate(row.oldestSubmittedAt) },
          ]}
        />
        <DataTable
          title="Taux d’approbation par manager"
          rows={data.management.approvalRateByManager}
          columns={[
            { header: "Manager", key: "manager" },
            { header: "Approuvées", align: "right", render: (row) => number(row, "approved") },
            { header: "Rejetées", align: "right", render: (row) => number(row, "rejected") },
            { header: "Taux", align: "right", render: (row) => formatPercent(row.rate) },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function BalancesSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Solde CP < 5 jours",
            value: formatNumber(data.balances.lowCpBalance.length),
            tone: "red",
          },
          {
            label: "Solde CP > 30 jours",
            value: formatNumber(data.balances.highCpBalance.length),
            tone: "orange",
          },
          {
            label: "Congés non planifiés",
            value: formatNumber(data.balances.unplannedLeave.length),
            tone: "yellow",
          },
          {
            label: "Reports cumulés",
            value: formatNumber(sumRows(data.balances.carryoverByDepartment, "carryover")),
            suffix: "jours",
            tone: "purple",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Employés avec faible solde de CP"
          rows={data.balances.lowCpBalance}
          columns={[
            ...employeeColumns,
            {
              header: "Solde restant",
              align: "right",
              render: (row) => number(row, "remaining", " j"),
            },
          ]}
        />
        <DataTable
          title="Employés avec solde élevé de CP"
          rows={data.balances.highCpBalance}
          columns={[
            ...employeeColumns,
            {
              header: "Solde restant",
              align: "right",
              render: (row) => number(row, "remaining", " j"),
            },
          ]}
        />
        <DataTable
          title="Congés non planifiés"
          rows={data.balances.unplannedLeave}
          columns={[
            ...employeeColumns,
            { header: "Droits", align: "right", render: (row) => number(row, "total", " j") },
            { header: "Pris", align: "right", render: (row) => number(row, "taken", " j") },
            {
              header: "Planifiés",
              align: "right",
              render: (row) => number(row, "scheduled", " j"),
            },
            {
              header: "Non planifiés",
              align: "right",
              render: (row) => number(row, "unplannedDays", " j"),
            },
          ]}
        />
        <DataTable
          title="Répartition des reports de congés"
          rows={data.balances.carryoverByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            { header: "Report", align: "right", render: (row) => number(row, "carryover", " j") },
          ]}
        />
        <DataTable
          title="Employés n’ayant pris aucun congé"
          rows={data.balances.employeesWithoutLeaveTaken}
          columns={employeeColumns}
        />
      </SectionGrid>
    </div>
  );
}

function SpecialEventsSection({ data }: { data: AnalyticsResponse }) {
  return (
    <div className="space-y-4">
      <KpiGrid
        items={[
          {
            label: "Naissances déclarées",
            value: formatNumber(eventCount(data.specialEvents.declaredEvents, "BIRTH")),
            tone: "blue",
          },
          {
            label: "Mariages déclarés",
            value: formatNumber(eventCount(data.specialEvents.declaredEvents, "MARRIAGE")),
            tone: "green",
          },
          {
            label: "Décès déclarés",
            value: formatNumber(eventCount(data.specialEvents.declaredEvents, "DEATH")),
            tone: "purple",
          },
          {
            label: "Plafond annuel atteint",
            value: formatNumber(data.specialEvents.employeesReachedAnnualCap.length),
            tone: "red",
          },
        ]}
      />
      <SectionGrid>
        <DataTable
          title="Répartition des événements par département"
          rows={data.specialEvents.eventsByDepartment}
          columns={[
            { header: "Département", key: "departmentName" },
            { header: "Total", align: "right", render: (row) => number(row, "total") },
            { header: "Naissances", align: "right", render: (row) => number(row, "births") },
            { header: "Mariages", align: "right", render: (row) => number(row, "marriages") },
            { header: "Décès", align: "right", render: (row) => number(row, "deaths") },
          ]}
        />
        <DataTable
          title="Jours de congés spéciaux consommés"
          rows={data.specialEvents.specialConsumedByType}
          columns={[
            { header: "Code", render: (row) => <CodeBadge value={row.code} tone="info" /> },
            { header: "Type", key: "type" },
            { header: "Jours", align: "right", render: (row) => number(row, "days", " j") },
            { header: "Demandes", align: "right", render: (row) => number(row, "requests") },
          ]}
        />
        <DataTable
          title="Employés ayant atteint le plafond annuel"
          rows={data.specialEvents.employeesReachedAnnualCap}
          columns={[
            ...employeeColumns,
            { header: "Consommé", align: "right", render: (row) => number(row, "used", " j") },
            { header: "Plafond", align: "right", render: (row) => number(row, "cap", " j") },
          ]}
        />
      </SectionGrid>
    </div>
  );
}

function renderSection(section: SectionId, data: AnalyticsResponse) {
  switch (section) {
    case "workforce":
      return <WorkforceSection data={data} />;
    case "leaves":
      return <LeavesSection data={data} />;
    case "alerts":
      return <AlertsSection data={data} />;
    case "trends":
      return <TrendsSection data={data} />;
    case "management":
      return <ManagementSection data={data} />;
    case "balances":
      return <BalancesSection data={data} />;
    case "specialEvents":
      return <SpecialEventsSection data={data} />;
  }
}

function AnalyticsPage({ section }: { section: SectionId }) {
  const copy = sectionCopy[section];
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const query = useQuery({
    queryKey: ["rh-analytics", ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<AnalyticsResponse>(buildAnalyticsPath(dateRange)),
  });
  const data = query.data ?? emptyAnalytics;

  return (
    <AppShell title={`Analytics RH · ${copy.title}`} subtitle={copy.subtitle}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
        <Button
          type="button"
          variant="outline"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`size-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {query.isError && (
        <Card className="mb-4 border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Impossible de charger les indicateurs RH. Vérifie la connexion backend puis réessaie.
        </Card>
      )}

      {query.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Chargement des indicateurs RH…</Card>
      ) : (
        renderSection(section, data)
      )}
    </AppShell>
  );
}

export function RhAnalyticsWorkforcePage() {
  return <AnalyticsPage section="workforce" />;
}

export function RhAnalyticsLeavesPage() {
  return <AnalyticsPage section="leaves" />;
}

export function RhAnalyticsAlertsPage() {
  return <AnalyticsPage section="alerts" />;
}

export function RhAnalyticsTrendsPage() {
  return <AnalyticsPage section="trends" />;
}

export function RhAnalyticsManagementPage() {
  return <AnalyticsPage section="management" />;
}

export function RhAnalyticsBalancesPage() {
  return <AnalyticsPage section="balances" />;
}

export function RhAnalyticsSpecialEventsPage() {
  return <AnalyticsPage section="specialEvents" />;
}
