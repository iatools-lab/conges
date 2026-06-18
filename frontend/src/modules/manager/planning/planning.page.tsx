import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import {
  AlertCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";

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
  planned: number;
  remaining: number;
  passif: number;
  alert: { tone: BadgeTone; label: string };
};

type PlanificationRow = {
  id: string;
  reference: string;
  employee: string;
  departmentCode: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  startDateIso: string;
  endDateIso: string;
  days: number;
  type: string;
  statusCode: string;
  status: BadgeTone;
  label: string;
};

type MonthlyLoadRow = {
  departmentCode: string;
  departmentName: string;
  months: number[];
};

type ManagerPlanningResponse = {
  year: number;
  manager: { id: string; fullName: string; email: string };
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

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear, currentYear - 1, currentYear - 2];
const monthLabels = [
  "Jan",
  "Fev",
  "Mar",
  "Avr",
  "Mai",
  "Juin",
  "Juil",
  "Aout",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const monthLabelsLong = [
  "Janvier",
  "Fevrier",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Aout",
  "Septembre",
  "Octobre",
  "Novembre",
  "Decembre",
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
  { status: "planned", label: "Planifie" },
  { status: "pending", label: "Soumis" },
  { status: "review", label: "En revue" },
  { status: "valid", label: "Confirme" },
  { status: "rejected", label: "Rejete" },
  { status: "neutral", label: "Annule" },
  { status: "draft", label: "Brouillon" },
];

function buildPlanningPath(managerId: string, managerEmail: string, year: string, department: string) {
  const params = new URLSearchParams({ year, managerId, managerEmail });
  if (department !== "ALL") params.set("department", department);

  return `/manager/planning?${params.toString()}`;
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
    "Employe",
    "Departement",
    "Manager",
    "Solde total",
    "Pris",
    "Planifie",
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
  link.download = `planning-equipe-manager-${year}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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
                    title={`${plan.employee} - ${plan.type}`}
                  >
                    {plan.employee} - {plan.type}
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

export function ManagerPlanning() {
  const { session } = useAuthSession();
  const [department, setDepartment] = useState("ALL");
  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedStatuses, setSelectedStatuses] = useState<BadgeTone[]>(
    STATUS_FILTERS.map((item) => item.status),
  );
  const [query, setQuery] = useState("");

  const enabled = Boolean(session?.id && session?.email);
  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["manager-planning", session?.id, session?.email, year, department],
    enabled,
    queryFn: () =>
      apiFetch<ManagerPlanningResponse>(buildPlanningPath(session!.id, session!.email, year, department)),
  });

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
  const planifications = (data?.planifications ?? []).filter((planification) => {
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
      title="Vue globale des conges (Manager)"
      subtitle="Pilotage des soldes et des planifications par departement"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
            <Building2 className="size-4" />
            Perimetre manager {data?.manager?.fullName ? `- ${data.manager.fullName}` : ""}
          </div>
          <select
            className="rounded-md border px-3 py-2 text-sm bg-background"
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border px-3 py-2 text-sm bg-background"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="ALL">Tous departements</option>
            {(data?.departments ?? []).map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher employe, manager..."
              className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard label="Effectif suivi" value={isLoading ? "..." : totals.employees} tone="blue" />
        <StatCard
          label="Jours planifies"
          value={isLoading ? "..." : formatNumber(totals.plannedDays)}
          tone="green"
        />
        <StatCard
          label="Conges pris"
          value={isLoading ? "..." : formatNumber(totals.takenDays)}
          tone="blue"
        />
        <StatCard
          label="Total conges"
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
              <span>Impossible de charger le planning manager depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Reessayer
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
                      setMonth((value) => {
                        if (value === 0) {
                          setYear(String(Number(year) - 1));
                          return 11;
                        }
                        return value - 1;
                      });
                    }}
                    aria-label="Mois precedent"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const now = new Date();
                      setMonth(now.getMonth());
                      setYear(String(now.getFullYear()));
                    }}
                  >
                    Aujourd'hui
                  </Button>
                  <Button
                    variant="outline"
                    className="!p-2"
                    onClick={() => {
                      setMonth((value) => {
                        if (value === 11) {
                          setYear(String(Number(year) + 1));
                          return 0;
                        }
                        return value + 1;
                      });
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
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3">Employe</th>
                    <th className="px-5 py-3">Departement</th>
                    <th className="px-5 py-3">Periode</th>
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
            <CardHeader title={`Planifications du mois selectionne (${monthLabelsLong[month]})`} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3">Employe</th>
                    <th className="px-5 py-3">Departement</th>
                    <th className="px-5 py-3">Periode</th>
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
                    <th className="px-5 py-3">Employe</th>
                    <th className="px-5 py-3">Departement</th>
                    <th className="px-5 py-3">Manager</th>
                    <th className="px-5 py-3">Solde total</th>
                    <th className="px-5 py-3">Pris</th>
                    <th className="px-5 py-3">Planifie</th>
                    <th className="px-5 py-3">Restant</th>
                    <th className="px-5 py-3">Passif</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.employee}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.manager}</td>
                      <td className="px-5 py-3">{formatNumber(row.total)}</td>
                      <td className="px-5 py-3">{formatNumber(row.taken)}</td>
                      <td className="px-5 py-3">{formatNumber(row.planned)}</td>
                      <td className="px-5 py-3 font-medium">{formatNumber(row.remaining)}</td>
                      <td className="px-5 py-3">{formatNumber(row.passif)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={8}>
                        Aucun solde trouve pour ce perimetre.
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
