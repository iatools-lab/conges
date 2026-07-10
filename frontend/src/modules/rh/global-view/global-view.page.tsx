import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { RowActions } from "@/components/RowActions";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeMonthIndex,
  dateRangeQueryKey,
  dateRangeYear,
  monthRange,
  yearRange,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { leaveYearForDate } from "@/lib/leave-year";
import {
  AlertCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type BadgeTone =
  | "valid"
  | "pending"
  | "rejected"
  | "draft"
  | "info"
  | "neutral"
  | "review"
  | "planned";

type DepartmentOption = {
  code: string;
  name: string;
};

type BalanceRow = {
  id: string;
  employee: string;
  departmentCode: string;
  departmentName: string;
  manager: string;
  total: number;
  taken: number;
  takenAdjustment: number;
  planned: number;
  remaining: number;
  passif: number;
  alert: { tone: BadgeTone; label: string };
};

type PlanificationRow = {
  id: string;
  reference: string;
  ownerId: string;
  employee: string;
  departmentCode: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  startDateIso: string;
  endDateIso: string;
  days: number;
  type: string;
  leaveTypeCode: string;
  leaveTypeCategory: string;
  canAdjustPlannedDays: boolean;
  statusCode: string;
  status: BadgeTone;
  label: string;
};

type MonthlyLoadRow = {
  departmentCode: string;
  departmentName: string;
  months: number[];
};

type GlobalViewResponse = {
  year: number;
  departments: DepartmentOption[];
  rows: BalanceRow[];
  planifications: PlanificationRow[];
  monthlyLoad: MonthlyLoadRow[];
  totals: {
    employees: number;
    plannedDays: number;
    liabilityDays: number;
    alerts: number;
  };
};

type TakenDaysAdjustmentResponse = {
  userId: string;
  year: number;
  previousTaken: number;
  taken: number;
  takenAdjustment: number;
};

type PlannedDaysAdjustmentResponse = {
  id: string;
  reference: string;
  userId: string;
  previousDays: number;
  days: number;
  startDate: string;
  previousEndDate: string;
  endDate: string;
};

const currentYear = leaveYearForDate();
const monthLabels = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Août",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

const monthLabelsLong = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const STATUS_STYLES: Record<BadgeTone, string> = {
  draft: "bg-status-draft text-status-draft-fg",
  pending: "bg-status-pending text-status-pending-fg",
  valid: "bg-stat-green text-stat-green-fg",
  rejected: "bg-status-rejected text-status-rejected-fg",
  neutral: "bg-muted text-muted-foreground",
  planned: "bg-stat-yellow text-stat-yellow-fg",
  review: "bg-stat-orange text-stat-orange-fg",
  info: "bg-stat-blue text-stat-blue-fg",
};

const STATUS_FILTERS: Array<{ status: BadgeTone; label: string }> = [
  { status: "planned", label: "Planifié" },
  { status: "pending", label: "Soumis" },
  { status: "review", label: "En revue" },
  { status: "valid", label: "Confirmé" },
  { status: "rejected", label: "Rejeté" },
  { status: "neutral", label: "Annulé" },
  { status: "draft", label: "Brouillon" },
];

function buildGlobalViewPath(range: DateRangeValue, department: string) {
  const params = appendDateRange(new URLSearchParams(), range);
  if (department !== "ALL") params.set("department", department);

  return `/rh/global-view?${params.toString()}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function firstWeekday(year: number, month: number) {
  const day = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return (day + 6) % 7;
}

function planCoversDay(plan: PlanificationRow, year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;

  return parseIsoDate(plan.startDateIso) <= date && date <= parseIsoDate(plan.endDateIso);
}

function planOverlapsMonth(plan: PlanificationRow, year: number, month: number) {
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));

  return parseIsoDate(plan.startDateIso) <= monthEnd && parseIsoDate(plan.endDateIso) >= monthStart;
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportRowsCsv(rows: BalanceRow[], year: string) {
  const headers = [
    "Employé",
    "Département",
    "Manager",
    "Solde total",
    "Pris",
    "Planifié",
    "Restant",
    "Passif",
  ];
  const csvRows = rows.map((row) => [
    row.employee,
    row.departmentName,
    row.manager,
    formatNumber(row.total),
    formatNumber(row.taken),
    formatNumber(row.planned),
    formatNumber(row.remaining),
    formatNumber(row.passif),
  ]);
  const csv = [headers, ...csvRows]
    .map((row) => row.map((value) => escapeCsvValue(value)).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `vue-globale-rh-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function BalanceRowActions({
  row,
  year,
  plannedRequests,
  disabledTaken,
  disabledPlanned,
  onSaveTaken,
  onSavePlanned,
}: {
  row: BalanceRow;
  year: number;
  plannedRequests: PlanificationRow[];
  disabledTaken: boolean;
  disabledPlanned: boolean;
  onSaveTaken: (taken: number, comment: string) => Promise<unknown>;
  onSavePlanned: (requestId: string, days: number, comment: string) => Promise<unknown>;
}) {
  const [takenOpen, setTakenOpen] = useState(false);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [taken, setTaken] = useState(String(row.taken));
  const [plannedRequestId, setPlannedRequestId] = useState(plannedRequests[0]?.id ?? "");
  const selectedPlan =
    plannedRequests.find((request) => request.id === plannedRequestId) ?? plannedRequests[0];
  const [plannedDays, setPlannedDays] = useState(String(selectedPlan?.days ?? row.planned));
  const [comment, setComment] = useState("");
  const [plannedComment, setPlannedComment] = useState("");

  const openTakenDialog = () => {
    setTaken(String(row.taken));
    setComment("");
    setTakenOpen(true);
  };

  const openPlannedDialog = () => {
    const firstPlan = plannedRequests[0];
    setPlannedRequestId(firstPlan?.id ?? "");
    setPlannedDays(String(firstPlan?.days ?? row.planned));
    setPlannedComment("");
    setPlannedOpen(true);
  };

  return (
    <>
      <RowActions
        actions={[
          {
            label: "Ajuster les jours pris",
            icon: Pencil,
            disabled: disabledTaken,
            onSelect: openTakenDialog,
          },
          {
            label: "Ajuster les jours planifiés",
            icon: Pencil,
            disabled: disabledPlanned || plannedRequests.length === 0,
            onSelect: openPlannedDialog,
          },
        ]}
      />
      <Dialog open={takenOpen} onOpenChange={setTakenOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Ajuster les jours pris</DialogTitle>
            <DialogDescription>
              Corrigez le total de {row.employee} pour {year}. Cette correction restera appliquée
              lors des prochaines synchronisations.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const nextTaken = Number(taken);
              if (!Number.isFinite(nextTaken) || nextTaken < 0) {
                toast.error("Le nombre de jours pris doit être positif ou nul");
                return;
              }
              await onSaveTaken(nextTaken, comment);
              setTakenOpen(false);
            }}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Jours pris</span>
              <input
                type="number"
                min="0"
                step="0.5"
                value={taken}
                onChange={(event) => setTaken(event.target.value)}
                className="rounded-md border bg-background px-3 py-2"
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                Motif de la correction
              </span>
              <textarea
                rows={3}
                maxLength={500}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="rounded-md border bg-background px-3 py-2"
                placeholder="Ex. régularisation validée par la RH"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTakenOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={disabledTaken}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={plannedOpen} onOpenChange={setPlannedOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Ajuster les jours planifiés</DialogTitle>
            <DialogDescription>
              Choisissez la planification de {row.employee}, puis indiquez le nouveau nombre de
              jours. La date de fin sera recalculée automatiquement en jours ouvrés.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const nextDays = Number(plannedDays);
              if (!plannedRequestId) {
                toast.error("Sélectionnez une planification");
                return;
              }
              if (!Number.isInteger(nextDays) || nextDays <= 0) {
                toast.error("Le nombre de jours planifiés doit être un entier positif");
                return;
              }
              await onSavePlanned(plannedRequestId, nextDays, plannedComment);
              setPlannedOpen(false);
            }}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Planification</span>
              <select
                value={plannedRequestId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const nextPlan = plannedRequests.find((request) => request.id === nextId);
                  setPlannedRequestId(nextId);
                  setPlannedDays(String(nextPlan?.days ?? ""));
                }}
                className="rounded-md border bg-background px-3 py-2"
                required
              >
                {plannedRequests.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.reference} · {plan.startDate} → {plan.endDate} · {formatNumber(plan.days)}{" "}
                    j
                  </option>
                ))}
              </select>
            </label>
            {selectedPlan && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Date de début conservée : {selectedPlan.startDate}. Date de fin actuelle :{" "}
                {selectedPlan.endDate}.
              </div>
            )}
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Jours planifiés</span>
              <input
                type="number"
                min="1"
                step="1"
                value={plannedDays}
                onChange={(event) => setPlannedDays(event.target.value)}
                className="rounded-md border bg-background px-3 py-2"
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                Motif de la correction
              </span>
              <textarea
                rows={3}
                maxLength={500}
                value={plannedComment}
                onChange={(event) => setPlannedComment(event.target.value)}
                className="rounded-md border bg-background px-3 py-2"
                placeholder="Ex. correction du planning validée par la RH"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPlannedOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={disabledPlanned || plannedRequests.length === 0}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MonthCalendar({
  year,
  month,
  plans,
}: {
  year: number;
  month: number;
  plans: PlanificationRow[];
}) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const visibleCells = Math.ceil((offset + total) / 7) * 7;

  return (
    <>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: visibleCells }, (_, index) => {
          const day = index - offset + 1;
          const inMonth = day >= 1 && day <= total;
          const dayPlans = inMonth
            ? plans.filter((plan) => planCoversDay(plan, year, month, day))
            : [];

          return (
            <div
              key={index}
              className={`min-h-24 rounded border p-2 text-sm ${
                !inMonth ? "bg-muted/30 text-muted-foreground/40" : "hover:bg-accent"
              }`}
            >
              <div className="text-xs">{inMonth ? day : ""}</div>
              <div className="mt-1 space-y-1">
                {dayPlans.slice(0, 3).map((plan) => (
                  <div
                    key={`${plan.id}-${day}`}
                    className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[plan.status]}`}
                    title={`${plan.employee} · ${plan.type}`}
                  >
                    {plan.employee} · {plan.type}
                  </div>
                ))}
                {dayPlans.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">+{dayPlans.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function MonthMini({
  year,
  month,
  plans,
  onClick,
  selected,
}: {
  year: number;
  month: number;
  plans: PlanificationRow[];
  onClick: () => void;
  selected: boolean;
}) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, index) => index + 1),
  ];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${
        selected ? "border-primary ring-1 ring-primary/40" : "hover:bg-accent"
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">{monthLabelsLong[month]}</span>
        <span className="text-xs text-muted-foreground">
          {plans.filter((plan) => planOverlapsMonth(plan, year, month)).length}
        </span>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => (
          <div key={`${day}-${index}`}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <div key={index} />;
          const hasPlan = plans.some((plan) => planCoversDay(plan, year, month, day));
          return (
            <div
              key={index}
              className={`flex aspect-square items-center justify-center rounded text-[10px] ${
                hasPlan ? "bg-stat-blue font-semibold text-stat-blue-fg" : "text-foreground/70"
              }`}
            >
              {day}
            </div>
          );
        })}
      </div>
    </button>
  );
}

function StatusFilterRow({
  selected,
  onToggle,
}: {
  selected: BadgeTone[];
  onToggle: (status: BadgeTone) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_FILTERS.map((item) => {
        const checked = selected.includes(item.status);

        return (
          <label
            key={item.status}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
              checked ? "border-transparent" : "border-border"
            } ${checked ? STATUS_STYLES[item.status] : "text-muted-foreground"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(item.status)}
              className="size-3.5 accent-current"
            />
            {item.label}
          </label>
        );
      })}
    </div>
  );
}

export function VueGlobale() {
  const queryClient = useQueryClient();
  const [department, setDepartment] = useState("ALL");
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedStatuses, setSelectedStatuses] = useState<BadgeTone[]>(
    STATUS_FILTERS.map((item) => item.status),
  );
  const [query, setQuery] = useState("");

  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["rh-global-view", department, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<GlobalViewResponse>(buildGlobalViewPath(dateRange, department)),
  });
  const updateTakenDays = useMutation({
    mutationFn: ({ userId, taken, comment }: { userId: string; taken: number; comment: string }) =>
      apiFetch<TakenDaysAdjustmentResponse>(`/rh/global-view/balances/${userId}/taken`, {
        method: "PATCH",
        body: JSON.stringify({ year: Number(year), taken, comment: comment.trim() || undefined }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast.success("Jours pris mis à jour");
    },
    onError: (error) => {
      toast.error("Correction impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });
  const updatePlannedDays = useMutation({
    mutationFn: ({
      requestId,
      days,
      comment,
    }: {
      requestId: string;
      days: number;
      comment: string;
    }) =>
      apiFetch<PlannedDaysAdjustmentResponse>(
        `/rh/global-view/requests/${requestId}/planned-days`,
        {
          method: "PATCH",
          body: JSON.stringify({ days, comment: comment.trim() || undefined }),
        },
      ),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries();
      toast.success("Jours planifiés mis à jour", {
        description: `${response.reference}: nouvelle date de fin ${response.endDate}`,
      });
    },
    onError: (error) => {
      toast.error("Correction impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const applyDateRange = (nextRange: DateRangeValue) => {
    setDateRange(nextRange);
    if (nextRange.dateFrom) {
      setYear(String(dateRangeYear(nextRange, currentYear)));
      setMonth(dateRangeMonthIndex(nextRange, new Date().getMonth()));
    }
  };

  const toggleStatus = (status: BadgeTone) => {
    setSelectedStatuses((current) => {
      if (current.includes(status)) {
        if (current.length === 1) return current;
        return current.filter((value) => value !== status);
      }
      return [...current, status];
    });
  };

  const searchText = query.trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((row) => {
    if (!searchText) return true;

    return [row.employee, row.departmentCode, row.departmentName, row.manager]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });
  const allPlanifications = data?.planifications ?? [];
  const planifications = allPlanifications.filter((planification) => {
    if (!selectedStatuses.includes(planification.status)) return false;
    if (!searchText) return true;

    return [
      planification.reference,
      planification.employee,
      planification.departmentCode,
      planification.departmentName,
      planification.type,
      planification.label,
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });
  const monthPlanifications = planifications.filter((plan) =>
    planOverlapsMonth(plan, Number(year), month),
  );
  const totalConge = rows.reduce((sum, row) => sum + row.total, 0);
  const totalPris = rows.reduce((sum, row) => sum + row.taken, 0);
  const totalPlanifie = rows.reduce((sum, row) => sum + row.planned, 0);
  const totalRestant = rows.reduce((sum, row) => sum + row.remaining, 0);
  const totals = {
    employees: rows.length,
    plannedDays: totalPlanifie,
    takenDays: totalPris,
    totalConge,
    remainingDays: totalRestant,
    liabilityDays: rows.reduce((sum, row) => sum + row.passif, 0),
  };

  return (
    <AppShell
      title="Vue globale des congés (RH)"
      subtitle="Pilotage des soldes et des planifications par département"
    >
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Département
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className="h-9 rounded-md border bg-card px-3 text-sm"
          >
            <option value="ALL">Tous départements</option>
            {(data?.departments ?? []).map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher employé, manager…"
            className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm"
          />
        </div>
        <DateRangeFilter value={dateRange} onChange={applyDateRange} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="Effectif suivi" value={isLoading ? "..." : totals.employees} tone="blue" />
        <StatCard
          label="Jours planifiés"
          value={isLoading ? "..." : formatNumber(totals.plannedDays)}
          tone="green"
        />
        <StatCard
          label="Congés pris"
          value={isLoading ? "..." : formatNumber(totals.takenDays)}
          tone="blue"
        />
        <StatCard
          label="Total congés"
          value={isLoading ? "..." : formatNumber(totals.totalConge)}
          tone="purple"
        />
        <StatCard
          label="Total restant"
          value={isLoading ? "..." : formatNumber(totals.remainingDays)}
          tone="yellow"
        />
        <StatCard
          label="Passif total"
          value={isLoading ? "..." : formatNumber(totals.liabilityDays)}
          tone="orange"
        />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger la vue globale depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Tabs defaultValue="mensuelle" className="mt-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="mensuelle">Planification mensuelle</TabsTrigger>
          <TabsTrigger value="annuelle">Planification annuelle</TabsTrigger>
          <TabsTrigger value="soldes">Soldes</TabsTrigger>
        </TabsList>

        <TabsContent value="mensuelle" className="mt-4">
          <Card className="mb-4 p-4">
            <div className="mb-2 text-sm font-medium">Filtrer par statut</div>
            <StatusFilterRow selected={selectedStatuses} onToggle={toggleStatus} />
          </Card>

          <Card>
            <CardHeader
              title={`${monthLabelsLong[month]} ${year}`}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="!p-2"
                    onClick={() => {
                      const nextMonth = month === 0 ? 11 : month - 1;
                      const nextYear = month === 0 ? Number(year) - 1 : Number(year);
                      setMonth(nextMonth);
                      setYear(String(nextYear));
                      setDateRange(monthRange(nextYear, nextMonth));
                    }}
                    aria-label="Mois précédent"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const now = new Date();
                      setMonth(now.getMonth());
                      setYear(String(now.getFullYear()));
                      setDateRange(monthRange(now.getFullYear(), now.getMonth()));
                    }}
                  >
                    Aujourd'hui
                  </Button>
                  <Button
                    variant="outline"
                    className="!p-2"
                    onClick={() => {
                      const nextMonth = month === 11 ? 0 : month + 1;
                      const nextYear = month === 11 ? Number(year) + 1 : Number(year);
                      setMonth(nextMonth);
                      setYear(String(nextYear));
                      setDateRange(monthRange(nextYear, nextMonth));
                    }}
                    aria-label="Mois suivant"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              }
            />
            <div className="p-5">
              <MonthCalendar year={Number(year)} month={month} plans={planifications} />
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader title={`Planifications du mois (${monthPlanifications.length})`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthPlanifications.map((planification) => (
                    <tr key={planification.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{planification.reference}</td>
                      <td className="px-5 py-3">{planification.employee}</td>
                      <td className="px-5 py-3">{planification.departmentName}</td>
                      <td className="px-5 py-3">
                        {planification.startDate} - {planification.endDate}
                      </td>
                      <td className="px-5 py-3">{formatNumber(planification.days)}</td>
                      <td className="px-5 py-3">{planification.type}</td>
                      <td className="px-5 py-3">
                        <Badge tone={planification.status}>{planification.label}</Badge>
                      </td>
                    </tr>
                  ))}
                  {!monthPlanifications.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                        Aucune planification pour ce mois.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="annuelle" className="mt-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-4">Planification annuelle - {year}</h3>
            <div className="mb-4">
              <StatusFilterRow selected={selectedStatuses} onToggle={toggleStatus} />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, monthIndex) => (
                <MonthMini
                  key={monthIndex}
                  year={Number(year)}
                  month={monthIndex}
                  plans={planifications}
                  selected={monthIndex === month}
                  onClick={() => setMonth(monthIndex)}
                />
              ))}
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader title={`Planifications du mois sélectionné (${monthLabelsLong[month]})`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthPlanifications.map((planification) => (
                    <tr key={planification.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{planification.reference}</td>
                      <td className="px-5 py-3">{planification.employee}</td>
                      <td className="px-5 py-3">{planification.departmentName}</td>
                      <td className="px-5 py-3">
                        {planification.startDate} - {planification.endDate}
                      </td>
                      <td className="px-5 py-3">{formatNumber(planification.days)}</td>
                      <td className="px-5 py-3">{planification.type}</td>
                      <td className="px-5 py-3">
                        <Badge tone={planification.status}>{planification.label}</Badge>
                      </td>
                    </tr>
                  ))}
                  {!monthPlanifications.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                        Aucune planification pour ce mois.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="soldes" className="mt-4">
          <Card className="overflow-hidden">
            <CardHeader
              title={`Soldes ${year}`}
              action={
                <Button variant="outline" onClick={() => exportRowsCsv(rows, year)}>
                  <Download className="size-4" /> Exporter CSV
                </Button>
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Manager</th>
                    <th className="px-5 py-3">Solde total</th>
                    <th className="px-5 py-3">Pris</th>
                    <th className="px-5 py-3">Planifié</th>
                    <th className="px-5 py-3">Restant</th>
                    <th className="px-5 py-3">Passif</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => {
                    const rowPlannedRequests = allPlanifications.filter(
                      (plan) => plan.ownerId === row.id && plan.canAdjustPlannedDays,
                    );

                    return (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{row.employee}</td>
                        <td className="px-5 py-3">{row.departmentName}</td>
                        <td className="px-5 py-3">{row.manager}</td>
                        <td className="px-5 py-3">{formatNumber(row.total)}</td>
                        <td className="px-5 py-3">
                          <div>{formatNumber(row.taken)}</div>
                          {row.takenAdjustment !== 0 && (
                            <div className="text-xs text-muted-foreground"> </div>
                          )}
                        </td>
                        <td className="px-5 py-3">{formatNumber(row.planned)}</td>
                        <td className="px-5 py-3 font-medium">{formatNumber(row.remaining)}</td>
                        <td className="px-5 py-3">{formatNumber(row.passif)}</td>
                        <td className="px-5 py-3 text-right">
                          <BalanceRowActions
                            row={row}
                            year={Number(year)}
                            plannedRequests={rowPlannedRequests}
                            disabledTaken={updateTakenDays.isPending}
                            disabledPlanned={updatePlannedDays.isPending}
                            onSaveTaken={(taken, comment) =>
                              updateTakenDays.mutateAsync({ userId: row.id, taken, comment })
                            }
                            onSavePlanned={(requestId, days, comment) =>
                              updatePlannedDays.mutateAsync({ requestId, days, comment })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={9}>
                        Aucun solde trouvé pour ce périmètre.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
