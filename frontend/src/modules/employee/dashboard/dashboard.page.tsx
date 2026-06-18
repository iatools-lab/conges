import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { StatCard, Card, CardHeader, Badge, Button } from "@/components/ui-kit";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import {
  AlertCircle,
  Baby,
  CalendarDays,
  CalendarPlus,
  FileText,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useAuthSession } from "@/modules/auth/session";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useState } from "react";

type BadgeTone = "valid" | "pending" | "rejected" | "draft" | "info" | "neutral";

type EmployeeDashboardSummary = {
  year: number;
  employee: {
    id: string;
    name: string;
    poste: string;
  };
  stats: {
    availableDays: number;
    annualDays: number;
    takenDays: number;
    scheduledDays: number;
    carryoverDays: number;
    seniorityBonusDays: number;
    childBonusDays: number;
    specialLeaveDays: number;
    specialLeaveLimit: number | null;
    pendingRequests: number;
  };
  nextAbsence: {
    id: string;
    reference: string;
    startDate: string;
    endDate: string;
    days: number;
    type: string;
    typeLabel: string;
    status: { tone: BadgeTone; label: string };
  } | null;
};

type EmployeeRequestRow = {
  id: string;
  reference: string;
  date: string;
  type: string;
  periode: string;
  jours: number;
  status: BadgeTone;
  stext: string;
  last: string;
};

type EmployeeLeaveRequestsResponse = {
  rows: EmployeeRequestRow[];
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function buildDashboardPath(userId: string, range: DateRangeValue) {
  const params = appendDateRange(new URLSearchParams(), range);
  const query = params.toString();
  return `/employee/dashboard/${userId}${query ? `?${query}` : ""}`;
}

function buildRequestsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
  });
  appendDateRange(params, range);

  return `/employee/leave-requests?${params.toString()}`;
}

export function EmployeeDashboard() {
  const { session } = useAuthSession();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["employee-dashboard", session?.id, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<EmployeeDashboardSummary>(buildDashboardPath(session!.id, dateRange)),
    enabled: Boolean(session?.id),
  });
  const stats = data?.stats;
  const loading = !session || isLoading;
  const requestsQuery = useQuery({
    queryKey: ["employee-dashboard-requests", session?.id, session?.email, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<EmployeeLeaveRequestsResponse>(buildRequestsPath(session!, dateRange)),
    enabled: Boolean(session?.id && session?.email),
  });
  const availableDays = formatNumber(stats?.availableDays ?? 0);
  const totalLeaveDays = formatNumber(
    (stats?.availableDays ?? 0) +
      (stats?.takenDays ?? 0) +
      (stats?.scheduledDays ?? 0),
  );
  const pendingRequests = stats?.pendingRequests ?? 0;
  const nextAbsence = data?.nextAbsence;
  const recentRequests = requestsQuery.data?.rows.slice(0, 5) ?? [];
  const quickActions = [
    {
      icon: <CalendarPlus className="size-5" />,
      label: "Faire une demande de congés",
      to: "/planifier",
    },
    {
      icon: <CalendarDays className="size-5" />,
      label: "Planifier mes congés",
      to: "/planifier",
    },
    {
      icon: <FileText className="size-5" />,
      label: "Suivre mes demandes",
      to: "/demandes",
    },
    {
      icon: <Baby className="size-5" />,
      label: "Déclarer un événement",
      to: "/declarer",
    },
    {
      icon: <Wallet className="size-5" />,
      label: "Voir mon solde",
      to: "/solde",
    },
    {
      icon: <FileText className="size-5" />,
      label: "Consulter mon historique",
      to: "/historique",
    },
  ] as const;

  return (
    <AppShell title={session ? `Bonjour, ${session.name}` : "Bonjour"} subtitle={session?.poste}>
      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Link
          to="/solde"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Total congés"
            value={loading ? "..." : totalLeaveDays}
            suffix="jours"
            tone="blue"
          />
        </Link>
        <Link
          to="/solde"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Solde disponible"
            value={loading ? "..." : availableDays}
            suffix="jours"
            tone="green"
          />
        </Link>
        <Link
          to="/solde"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Passif disponible"
            value={loading ? "..." : formatNumber(stats?.carryoverDays ?? 0)}
            suffix="jours"
            tone="orange"
          />
        </Link>
        <Link
          to="/planifier"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Jours planifiés"
            value={loading ? "..." : formatNumber(stats?.scheduledDays ?? 0)}
            suffix="jours"
            tone="yellow"
          />
        </Link>
        <Link
          to="/planifier"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Jours déjà pris"
            value={loading ? "..." : formatNumber(stats?.takenDays ?? 0)}
            suffix="jours"
            tone="red"
          />
        </Link>
        <Link
          to="/planifier"
          className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Demandes en cours"
            value={loading ? "..." : String(pendingRequests)}
            tone="purple"
          />
        </Link>
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger vos indicateurs depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-0">
          <CardHeader title="Actions rapides" />
          <div className="grid gap-1 p-3 text-sm sm:grid-cols-2">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className="group flex items-center gap-3 rounded-md px-3 py-3 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="rounded-md bg-stat-blue p-2 text-stat-blue-fg transition-colors group-hover:bg-navy group-hover:text-navy-foreground">
                  {action.icon}
                </span>
                <span className="font-medium">{action.label}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Prochaine absence"
            action={
              <Link to="/demandes" className="text-sm font-medium text-primary hover:underline">
                Mes demandes
              </Link>
            }
          />
          <div className="p-5 text-sm">
            {loading ? (
              <div className="text-muted-foreground">Chargement...</div>
            ) : nextAbsence ? (
              <div className="space-y-3">
                <div>
                  <div className="font-medium">{nextAbsence.typeLabel}</div>
                  <div className="mt-1 text-muted-foreground">
                    {formatDate(nextAbsence.startDate)} → {formatDate(nextAbsence.endDate)} ·{" "}
                    {formatNumber(nextAbsence.days)} j.
                  </div>
                </div>
                <Badge tone={nextAbsence.status.tone}>{nextAbsence.status.label}</Badge>
              </div>
            ) : (
              <div className="text-muted-foreground">Aucune absence validée à venir.</div>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Historique récent des demandes"
          action={
            <Link to="/demandes" className="text-sm font-medium text-primary hover:underline">
              Voir tout
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Référence</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Période</th>
                <th className="px-5 py-3">Jours</th>
                <th className="px-5 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {requestsQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Chargement des demandes...
                  </td>
                </tr>
              ) : recentRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Aucune demande récente.
                  </td>
                </tr>
              ) : (
                recentRequests.map((request) => (
                  <tr key={request.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{request.reference}</td>
                    <td className="px-5 py-3">{request.date}</td>
                    <td className="px-5 py-3">{request.type}</td>
                    <td className="px-5 py-3">{request.periode}</td>
                    <td className="px-5 py-3">{formatNumber(request.jours)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={request.status}>{request.stext}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
