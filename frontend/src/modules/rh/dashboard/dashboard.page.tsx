import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, StatCard } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Baby,
  CalendarClock,
  CalendarOff,
  ClipboardCheck,
  FileText,
  Globe,
  Settings2,
  Siren,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";

type StatTone = "green" | "blue" | "orange" | "yellow" | "red" | "purple";
type AlertTone = "valid" | "pending" | "rejected" | "info" | "neutral";
type DashboardLeaveTone = AlertTone | "draft" | "review" | "planned";

type DepartmentDistribution = {
  label: string;
  count: number;
  percent: number;
  tone: StatTone;
};

type RhDashboardLeaveRow = {
  id: string;
  reference: string;
  employee: string;
  department: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  statusCode: string;
  status: DashboardLeaveTone;
  statusLabel: string;
};

type RhDashboardSummary = {
  year: number;
  stats: {
    activeEmployees: number;
    onLeaveEmployees: number;
    inactiveEmployees: number;
    plannedDays: number;
    takenDays: number;
    remainingLiability: number;
    specialLeavesUsed: number;
    employeesWithoutPlanning: number;
    complianceAlerts: number;
    pendingRequests: number;
    activeConflicts: number;
    pendingEvents: number;
  };
  alerts: { label: string; tone: AlertTone }[];
  plannedLeaves: RhDashboardLeaveRow[];
  requestLeaves: RhDashboardLeaveRow[];
  departments: DepartmentDistribution[];
};

function buildDashboardPath(range: DateRangeValue) {
  const params = appendDateRange(new URLSearchParams(), range);
  const query = params.toString();
  return query ? `/rh/dashboard?${query}` : "/rh/dashboard";
}

const emptySummary: RhDashboardSummary = {
  year: new Date().getFullYear(),
  stats: {
    activeEmployees: 0,
    onLeaveEmployees: 0,
    inactiveEmployees: 0,
    plannedDays: 0,
    takenDays: 0,
    remainingLiability: 0,
    specialLeavesUsed: 0,
    employeesWithoutPlanning: 0,
    complianceAlerts: 0,
    pendingRequests: 0,
    activeConflicts: 0,
    pendingEvents: 0,
  },
  alerts: [{ label: "Aucune alerte RH active.", tone: "valid" }],
  plannedLeaves: [],
  requestLeaves: [],
  departments: [],
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value}T00:00:00.000Z`));
}

const quickActions = [
  {
    icon: <Globe className="size-5" />,
    label: "Piloter la vue globale",
    to: "/rh/global",
  },
  {
    icon: <ClipboardCheck className="size-5" />,
    label: "Traiter les demandes",
    to: "/rh/demandes-conges",
  },
  {
    icon: <Siren className="size-5" />,
    label: "Valider les événements",
    to: "/rh/speciaux",
  },
  {
    icon: <ShieldAlert className="size-5" />,
    label: "Traiter les alertes",
    to: "/rh/alertes",
  },
  {
    icon: <Users className="size-5" />,
    label: "Gérer les employés",
    to: "/rh/employes",
  },
  {
    icon: <Baby className="size-5" />,
    label: "Suivre les enfants",
    to: "/rh/enfants",
  },
  {
    icon: <Settings2 className="size-5" />,
    label: "Paramétrer les congés",
    to: "/rh/parametres",
  },
  {
    icon: <CalendarOff className="size-5" />,
    label: "Gérer les jours fériés",
    to: "/rh/feries",
  },
  {
    icon: <FileText className="size-5" />,
    label: "Préparer les exports",
    to: "/rh/exports",
  },
] as const;

function KpiLink({
  to,
  label,
  value,
  suffix,
  tone,
  hint,
}: {
  to: string;
  label: string;
  value: ReactNode;
  suffix?: string;
  tone: StatTone;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <StatCard label={label} value={value} suffix={suffix} tone={tone} hint={hint} />
    </Link>
  );
}

function RhLeaveTable({ rows, emptyMessage }: { rows: RhDashboardLeaveRow[]; emptyMessage: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-3">Employé</th>
            <th className="px-5 py-3">Référence</th>
            <th className="px-5 py-3">Type</th>
            <th className="px-5 py-3">Période</th>
            <th className="px-5 py-3">Jours</th>
            <th className="px-5 py-3">Statut</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/30">
              <td className="px-5 py-3">
                <div className="font-medium">{row.employee}</div>
                <div className="text-xs text-muted-foreground">{row.department}</div>
              </td>
              <td className="px-5 py-3 font-medium">{row.reference}</td>
              <td className="px-5 py-3">{row.type}</td>
              <td className="px-5 py-3">
                {formatDate(row.startDate)} - {formatDate(row.endDate)}
              </td>
              <td className="px-5 py-3">{formatNumber(row.days)}</td>
              <td className="px-5 py-3">
                <Badge tone={row.status}>{row.statusLabel}</Badge>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td className="px-5 py-8 text-center text-muted-foreground" colSpan={6}>
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PriorityRow({
  label,
  value,
  tone,
  to,
}: {
  label: string;
  value: number;
  tone: DashboardLeaveTone;
  to: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{value}</Badge>
        <Link to={to} className="text-xs text-primary hover:underline">
          Ouvrir
        </Link>
      </div>
    </li>
  );
}

export function RhDashboard() {
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["rh-dashboard", ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<RhDashboardSummary>(buildDashboardPath(dateRange)),
  });
  const summary = data ?? emptySummary;
  const stats = summary.stats;
  const plannedLeaves = summary.plannedLeaves ?? [];
  const requestLeaves = summary.requestLeaves ?? [];
  const totalLeaves = plannedLeaves.length + requestLeaves.length;
  const totalLeaveDays =
    stats.remainingLiability + stats.plannedDays + stats.takenDays;

  return (
    <AppShell title="Tableau de bord RH" subtitle="Priorités, risques et pilotage congés">
      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiLink
          to="/rh/global"
          label="Total congés"
          value={isLoading ? "..." : formatNumber(totalLeaveDays)}
          suffix="jours"
          tone="blue"
          hint="Pris + planifiés + restant"
        />
        <KpiLink
          to="/rh/demandes-conges"
          label="Demandes en attente"
          value={isLoading ? "..." : stats.pendingRequests}
          tone="purple"
          hint="Actions N+1 et RH à suivre"
        />
        <KpiLink
          to="/rh/speciaux"
          label="Événements en attente"
          value={isLoading ? "..." : stats.pendingEvents}
          tone="yellow"
          hint="Naissance, mariage, deuil..."
        />
        <KpiLink
          to="/rh/alertes"
          label="Alertes conformité"
          value={isLoading ? "..." : stats.complianceAlerts}
          tone="red"
          hint="Risques à corriger"
        />
        <KpiLink
          to="/rh/global"
          label="Conflits actifs"
          value={isLoading ? "..." : stats.activeConflicts}
          tone="orange"
          hint="Chevauchements à arbitrer"
        />
        <KpiLink
          to="/rh/global"
          label="Employés sans planning"
          value={isLoading ? "..." : stats.employeesWithoutPlanning}
          tone="green"
          hint="Suivi de planification"
        />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger les indicateurs RH depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Tabs defaultValue="executive" className="mt-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="executive">Vue exécutive</TabsTrigger>
          <TabsTrigger value="flow">Flux à traiter ({totalLeaves})</TabsTrigger>
        </TabsList>

        <TabsContent value="executive" className="mt-4 space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Siren className="size-4 text-status-rejected-fg" />
                <h3 className="font-semibold">Priorités du jour</h3>
              </div>
              <ul className="space-y-2">
                <PriorityRow
                  label="Demandes en attente N+1/RH"
                  value={stats.pendingRequests}
                  tone="review"
                  to="/rh/global"
                />
                <PriorityRow
                  label="Alertes conformité actives"
                  value={stats.complianceAlerts}
                  tone="rejected"
                  to="/rh/alertes"
                />
                <PriorityRow
                  label="Conflits de planning"
                  value={stats.activeConflicts}
                  tone="pending"
                  to="/rh/global"
                />
                <PriorityRow
                  label="Événements en attente"
                  value={stats.pendingEvents}
                  tone="info"
                  to="/rh/speciaux"
                />
              </ul>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardCheck className="size-4 text-status-valid-fg" />
                <h3 className="font-semibold">Santé globale</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Effectif actif</span>
                  <strong>{isLoading ? "..." : stats.activeEmployees}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Congés planifiés</span>
                  <strong>{isLoading ? "..." : formatNumber(stats.plannedDays)} j</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Congés pris</span>
                  <strong>{isLoading ? "..." : formatNumber(stats.takenDays)} j</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Employés inactifs</span>
                  <strong>{isLoading ? "..." : stats.inactiveEmployees}</strong>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="size-4 text-status-pending-fg" />
                <h3 className="font-semibold">Alertes récentes</h3>
              </div>
              <ul className="text-sm space-y-3 text-muted-foreground">
                {summary.alerts.map((alert) => (
                  <li key={alert.label} className="flex items-start gap-2">
                    <Badge tone={alert.tone}>RH</Badge>
                    <span>{alert.label}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm">
                  <Link to="/rh/alertes">Ouvrir toutes les alertes</Link>
                </Button>
              </div>
            </Card>

            <Card className="p-0">
              <div className="border-b px-5 py-4 flex items-center gap-2">
                <CalendarClock className="size-4 text-stat-blue-fg" />
                <h3 className="font-semibold">Accès rapides</h3>
              </div>
              <div className="grid gap-1 p-3 text-sm sm:grid-cols-2">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    to={action.to}
                    className="group flex items-center gap-3 rounded-md px-3 py-3 hover:bg-accent"
                  >
                    <span className="rounded-md bg-stat-blue p-2 text-stat-blue-fg transition-colors group-hover:bg-navy group-hover:text-navy-foreground">
                      {action.icon}
                    </span>
                    <span className="font-medium">{action.label}</span>
                    <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="flow" className="mt-4 space-y-6">
          <Card>
            <div className="border-b px-5 py-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Congés planifiés ({plannedLeaves.length})</h3>
              <Button asChild variant="ghost" size="sm">
                <Link to="/rh/global">Voir en détail</Link>
              </Button>
            </div>
            <RhLeaveTable
              rows={plannedLeaves.slice(0, 8)}
              emptyMessage="Aucun congé planifié pour l'année en cours."
            />
          </Card>

          <Card>
            <div className="border-b px-5 py-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">Demandes, validations et congés pris ({requestLeaves.length})</h3>
              <Button asChild variant="ghost" size="sm">
                <Link to="/rh/global">Voir en détail</Link>
              </Button>
            </div>
            <RhLeaveTable
              rows={requestLeaves.slice(0, 8)}
              emptyMessage="Aucune demande ou absence confirmée pour l'année en cours."
            />
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
