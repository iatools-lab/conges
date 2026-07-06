import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentMonthRange,
  dateRangeMonthIndex,
  dateRangeQueryKey,
  dateRangeYear,
  monthRange,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  Search,
} from "lucide-react";

type LeaveStatus = "draft" | "pending" | "manager" | "rh" | "conflict";

type Bar = {
  id: string;
  reference: string;
  s: number;
  e: number;
  type: string;
  status: LeaveStatus;
  statusLabel: string;
  isPlanned: boolean;
  startDate: string;
  endDate: string;
  days: number;
};

type Member = {
  id: string;
  name: string;
  matricule: string;
  role: string;
  department: string;
  departmentCode: string;
  bars: Bar[];
};

type BalanceRow = {
  id: string;
  name: string;
  matricule: string;
  department: string;
  departmentCode: string;
  total: number;
  taken: number;
  planned: number;
  remaining: number;
  passif: number;
  alert: "ok" | "low" | "negative" | "passif";
};

type OldestPending = {
  id: string;
  reference: string;
  employeeName: string;
  matricule: string;
  type: string;
  startDate: string;
  endDate: string;
  submittedAt: string | null;
};

type CalendarHoliday = {
  id: string;
  date: string;
  name: string;
};

type ManagerDashboardResponse = {
  year: number;
  month: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  stats: {
    totalLeaves: number;
    pendingRequests: number;
    urgentPendingRequests: number;
    upcomingAbsences7d: number;
    absentEmployees: number;
    activeConflicts: number;
    annualPlansMissing: number;
    planningRate: number;
    totalAbsenceDays: number;
    teamSize: number;
  };
  balances: BalanceRow[];
  attention: {
    oldestPending: OldestPending[];
  };
  holidays: CalendarHoliday[];
  team: Member[];
};

const STATUS_STYLES: Record<LeaveStatus, { bg: string; label: string }> = {
  draft: { bg: "bg-status-draft", label: "Brouillon" },
  pending: { bg: "bg-status-pending", label: "Soumis" },
  manager: { bg: "bg-stat-orange-fg", label: "En revue" },
  rh: { bg: "bg-stat-green-fg", label: "Validé" },
  conflict: { bg: "bg-stat-red-fg", label: "Conflit" },
};

const TYPE_DOT: Record<string, string> = {
  CP: "bg-stat-green-fg",
  RTT: "bg-stat-orange-fg",
  Spécial: "bg-stat-purple-fg",
  Maladie: "bg-stat-blue-fg",
  "Sans solde": "bg-stat-yellow-fg",
};

const MONTHS = [
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
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const emptyTeam: Member[] = [];
const emptyStats: ManagerDashboardResponse["stats"] = {
  totalLeaves: 0,
  pendingRequests: 0,
  urgentPendingRequests: 0,
  upcomingAbsences7d: 0,
  absentEmployees: 0,
  activeConflicts: 0,
  annualPlansMissing: 0,
  planningRate: 100,
  totalAbsenceDays: 0,
  teamSize: 0,
};
const emptyAttention: ManagerDashboardResponse["attention"] = {
  oldestPending: [],
};
const emptyBalances: BalanceRow[] = [];
const emptyHolidays: CalendarHoliday[] = [];

function buildDashboardPath(
  session: { id: string; email: string },
  range: DateRangeValue,
  year: number,
  monthIdx: number,
) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
    year: String(year),
    month: String(monthIdx + 1),
  });
  appendDateRange(params, range);

  return `/manager/dashboard?${params.toString()}`;
}

function getTypeDot(type: string) {
  return TYPE_DOT[type] ?? "bg-stat-blue-fg";
}

const quickActions = [
  {
    icon: <ClipboardCheck className="size-5" />,
    label: "Valider les demandes",
    to: "/manager/demandes",
  },
  {
    icon: <AlertTriangle className="size-5" />,
    label: "Résoudre les conflits",
    to: "/manager/conflits",
  },
  {
    icon: <CalendarDays className="size-5" />,
    label: "Lire le calendrier",
    to: "/manager/planning",
  },
  {
    icon: <CalendarDays className="size-5" />,
    label: "Historique validations",
    to: "/manager/historique",
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
  tone: "green" | "blue" | "orange" | "yellow" | "red" | "purple";
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

function exportCalendarCsv(rows: Member[], year: number, monthIdx: number) {
  const headers = [
    "Employé",
    "Département",
    "Poste",
    "Référence",
    "Type",
    "Début",
    "Fin",
    "Jours",
    "Statut",
  ];
  const lines = rows.flatMap((member) =>
    member.bars.map((bar) =>
      [
        member.name,
        member.department,
        member.role,
        bar.reference,
        bar.type,
        bar.startDate.slice(0, 10),
        bar.endDate.slice(0, 10),
        String(bar.days),
        bar.statusLabel,
      ]
        .map((value) => `"${value.replace(/"/g, '""')}"`)
        .join(";"),
    ),
  );
  const csv = [`\uFEFF${headers.join(";")}`, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `manager-dashboard-${year}-${String(monthIdx + 1).padStart(2, "0")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ManagerDashboard() {
  const { ready, session } = useAuthSession();
  const today = new Date();
  const [monthIdx, setMonthIdx] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentMonthRange(today));
  const [dept, setDept] = useState<string>("all");
  const [typeF, setTypeF] = useState<string>("all");
  const [statusF, setStatusF] = useState<"all" | LeaveStatus>("all");
  const [query, setQuery] = useState("");

  const dashboardQuery = useQuery({
    queryKey: [
      "manager-dashboard",
      session?.id,
      session?.email,
      year,
      monthIdx,
      ...dateRangeQueryKey(dateRange),
    ],
    queryFn: () =>
      apiFetch<ManagerDashboardResponse>(buildDashboardPath(session!, dateRange, year, monthIdx)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const team = dashboardQuery.data?.team ?? emptyTeam;
  const stats = dashboardQuery.data?.stats ?? emptyStats;
  const attention = dashboardQuery.data?.attention ?? emptyAttention;
  const balances = dashboardQuery.data?.balances ?? emptyBalances;
  const holidays = dashboardQuery.data?.holidays ?? emptyHolidays;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const firstDow = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const holidaysByDay = useMemo(
    () =>
      new Map(
        holidays
          .filter((holiday) =>
            holiday.date.startsWith(`${year}-${String(monthIdx + 1).padStart(2, "0")}`),
          )
          .map((holiday) => [Number(holiday.date.slice(8, 10)), holiday]),
      ),
    [holidays, monthIdx, year],
  );
  const nonWorkingDays = useMemo(() => {
    const days = new Set<number>();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const weekDay = new Date(Date.UTC(year, monthIdx, day)).getUTCDay();
      if (weekDay === 0 || weekDay === 6 || holidaysByDay.has(day)) days.add(day);
    }
    return days;
  }, [daysInMonth, holidaysByDay, monthIdx, year]);

  const departments = useMemo(
    () => Array.from(new Set(team.map((member) => member.department))),
    [team],
  );
  const leaveTypes = useMemo(
    () => Array.from(new Set(team.flatMap((member) => member.bars.map((bar) => bar.type)))),
    [team],
  );
  const filtered = useMemo(() => {
    const searchText = query.trim().toLowerCase();
    return team
      .filter((member) => dept === "all" || member.department === dept)
      .filter(
        (member) =>
          !searchText ||
          member.name.toLowerCase().includes(searchText) ||
          member.matricule.toLowerCase().includes(searchText) ||
          member.bars.some((bar) => bar.reference.toLowerCase().includes(searchText)),
      )
      .map((member) => ({
        ...member,
        bars: member.bars.filter(
          (bar) =>
            (typeF === "all" || bar.type === typeF) &&
            (statusF === "all" || bar.status === statusF),
        ),
      }));
  }, [dept, query, statusF, team, typeF]);
  const nowMs = Date.now();
  const oldestPendingRows = useMemo(
    () =>
      attention.oldestPending.map((item) => {
        const ageHours = item.submittedAt
          ? Math.max(0, Math.floor((nowMs - new Date(item.submittedAt).getTime()) / 3600000))
          : 0;
        return {
          ...item,
          ageHours,
          isUrgent: ageHours >= 48,
        };
      }),
    [attention.oldestPending, nowMs],
  );

  const coverage = useMemo(() => {
    const days = Array.from({ length: daysInMonth }, () => 0);
    filtered.forEach((member) => {
      member.bars.forEach((bar) => {
        for (let day = bar.s; day <= bar.e && day <= daysInMonth; day += 1) {
          if (!nonWorkingDays.has(day)) days[day - 1] += 1;
        }
      });
    });
    return days;
  }, [daysInMonth, filtered, nonWorkingDays]);

  const maxAbsences = Math.max(1, ...coverage);
  const totalAbsences = coverage.reduce((sum, dayAbsences) => sum + dayAbsences, 0);
  const departmentLabel =
    dashboardQuery.data?.manager.managedDepartments
      .map((department) => department.name)
      .join(", ") ||
    session?.department?.name ||
    "votre équipe";

  const applyDateRange = (nextRange: DateRangeValue) => {
    setDateRange(nextRange);
    if (nextRange.dateFrom) {
      setYear(dateRangeYear(nextRange, today.getFullYear()));
      setMonthIdx(dateRangeMonthIndex(nextRange, today.getMonth()));
    }
  };

  const goPrev = () => {
    const nextMonth = monthIdx === 0 ? 11 : monthIdx - 1;
    const nextYear = monthIdx === 0 ? year - 1 : year;
    setMonthIdx(nextMonth);
    setYear(nextYear);
    setDateRange(monthRange(nextYear, nextMonth));
  };
  const goNext = () => {
    const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1;
    const nextYear = monthIdx === 11 ? year + 1 : year;
    setMonthIdx(nextMonth);
    setYear(nextYear);
    setDateRange(monthRange(nextYear, nextMonth));
  };

  return (
    <AppShell
      title="Tableau de bord Manager"
      subtitle={`Vue d'équipe ${departmentLabel} — ${MONTHS[monthIdx]} ${year}`}
    >
      <DateRangeFilter value={dateRange} onChange={applyDateRange} className="mb-4" compact />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiLink
          to="/manager/planning"
          label="Total congés"
          value={stats.totalLeaves}
          suffix="j"
          tone="green"
          hint="Source : vue globale des congés"
        />
        <KpiLink
          to="/manager/demandes"
          label="Demandes en attente"
          value={stats.pendingRequests}
          tone="blue"
          hint="Source : demandes"
        />
        <KpiLink
          to="/manager/demandes"
          label="Demandes urgentes (>48h)"
          value={stats.urgentPendingRequests}
          tone="red"
          hint="Source : demandes"
        />
        <KpiLink
          to="/manager/planning"
          label="Absences prochaines 7j"
          value={stats.upcomingAbsences7d}
          tone="yellow"
          hint="Source : calendrier"
        />
        <KpiLink
          to="/manager/planning"
          label="Employés absents ce mois"
          value={stats.absentEmployees}
          tone="green"
          hint="Source : calendrier"
        />
        <KpiLink
          to="/manager/conflits"
          label="Conflits détectés"
          value={stats.activeConflicts}
          tone="red"
          hint="Source : conflits"
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Charge de validation du jour" />
        {oldestPendingRows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            Aucune demande en attente pour le moment.
          </div>
        ) : (
          <div className="divide-y">
            {oldestPendingRows.map((row) => (
              <a
                key={row.id}
                href={`/manager/demandes?q=${encodeURIComponent(row.reference)}&status=ALL`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted/30"
              >
                <Badge tone={row.isUrgent ? "rejected" : "pending"}>
                  {row.isUrgent ? "Urgent" : "À traiter"}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {row.reference} · {row.employeeName} ({row.matricule})
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {row.type} · {row.startDate.slice(0, 10)} → {row.endDate.slice(0, 10)}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{row.ageHours}h en attente</div>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card className="mt-6 p-0">
        <CardHeader title="Actions rapides" />
        <div className="grid gap-1 p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
              <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={`Soldes de congés ${year} — équipe`}
          action={
            <span className="text-xs text-muted-foreground">{balances.length} employé(s)</span>
          }
        />
        {dashboardQuery.isLoading ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">Chargement des soldes...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-5 py-3">Employé</th>
                  <th className="px-5 py-3">Matricule</th>
                  <th className="px-5 py-3">Département</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Pris</th>
                  <th className="px-5 py-3">Planifié</th>
                  <th className="px-5 py-3">Restant</th>
                  <th className="px-5 py-3">Congés passif</th>
                  <th className="px-5 py-3">Alerte</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {balances.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">
                      Aucun solde disponible pour cette année.
                    </td>
                  </tr>
                )}
                {balances
                  .filter((row) => dept === "all" || row.department === dept)
                  .map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.name}</td>
                      <td className="px-5 py-3 text-muted-foreground">{row.matricule}</td>
                      <td className="px-5 py-3">{row.department}</td>
                      <td className="px-5 py-3">{row.total} j</td>
                      <td className="px-5 py-3">{row.taken} j</td>
                      <td className="px-5 py-3">{row.planned} j</td>
                      <td className="px-5 py-3 font-semibold">{row.remaining} j</td>
                      <td className="px-5 py-3 font-semibold">
                        {row.passif > 0 ? (
                          <span className="font-semibold text-amber-600">{row.passif} j</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {row.alert === "negative" && <Badge tone="rejected">Solde négatif</Badge>}
                        {row.alert === "passif" && <Badge tone="pending">Passif à apurer</Badge>}
                        {row.alert === "low" && <Badge tone="pending">Solde faible</Badge>}
                        {row.alert === "ok" && <Badge tone="valid">OK</Badge>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader
            title={`Calendrier équipe — ${MONTHS[monthIdx]} ${year}`}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  className="!p-2"
                  onClick={goPrev}
                  aria-label="Mois précédent"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setMonthIdx(today.getMonth());
                    setYear(today.getFullYear());
                    setDateRange(monthRange(today.getFullYear(), today.getMonth()));
                  }}
                >
                  Aujourd'hui
                </Button>
                <Button
                  variant="outline"
                  className="!p-2"
                  onClick={goNext}
                  aria-label="Mois suivant"
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportCalendarCsv(filtered, year, monthIdx)}
                >
                  <Download className="size-4" /> Exporter
                </Button>
              </div>
            }
          />
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Nom, matricule, référence…"
                  className="w-full pl-8 sm:w-56"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select
                value={statusF}
                onValueChange={(value) => setStatusF(value as "all" | LeaveStatus)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Statut" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="pending">Soumis</SelectItem>
                  <SelectItem value="manager">En revue</SelectItem>
                  <SelectItem value="rh">Validé</SelectItem>
                  <SelectItem value="conflict">Conflit</SelectItem>
                  <SelectItem value="draft">Brouillon</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Département" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les départements</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department} value={department}>
                      {department}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeF} onValueChange={setTypeF}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les types</SelectItem>
                  {leaveTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  <b className="text-foreground">{totalAbsences}</b> j. d'absences
                </span>
                <span>
                  <b className="text-foreground">{filtered.length}</b> employés
                </span>
              </div>
            </div>

            {dashboardQuery.isLoading ? (
              <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
                Chargement du tableau de bord manager...
              </div>
            ) : dashboardQuery.isError ? (
              <div className="rounded-md border border-destructive/30 py-12 text-center text-sm text-destructive">
                Impossible de charger le tableau de bord manager.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  <div className="mb-1 grid grid-cols-[220px_1fr] gap-2 text-[11px] text-muted-foreground">
                    <div />
                    <div
                      className="grid gap-px"
                      style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))` }}
                    >
                      {Array.from({ length: daysInMonth }).map((_, index) => {
                        const dow = (firstDow + index) % 7;
                        const weekend = dow >= 5;
                        const holiday = holidaysByDay.get(index + 1);
                        return (
                          <div
                            key={index}
                            className={`py-1 text-center leading-tight ${weekend || holiday ? "rounded-sm bg-muted/60" : ""}`}
                            title={holiday?.name}
                          >
                            <div className="text-[10px] opacity-60">{WEEKDAYS[dow]}</div>
                            <div className="font-medium text-foreground/80">
                              {String(index + 1).padStart(2, "0")}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <TooltipProvider delayDuration={100}>
                    <div className="space-y-1.5">
                      {filtered.map((member) => (
                        <div
                          key={member.id}
                          className="grid grid-cols-[220px_1fr] items-center gap-2"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-sm">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-stat-blue-fg to-stat-purple-fg text-[11px] font-semibold text-white">
                              {member.name
                                .split(" ")
                                .map((namePart) => namePart[0])
                                .slice(0, 2)
                                .join("")}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{member.name}</div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                {member.department} · {member.role}
                              </div>
                            </div>
                          </div>
                          <div className="relative h-9 overflow-hidden rounded-md bg-muted/40">
                            <div
                              className="absolute inset-0 grid gap-px"
                              style={{
                                gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
                              }}
                            >
                              {Array.from({ length: daysInMonth }).map((_, index) => {
                                const dow = (firstDow + index) % 7;
                                const nonWorking = dow >= 5 || holidaysByDay.has(index + 1);
                                return (
                                  <div key={index} className={nonWorking ? "bg-muted/70" : ""} />
                                );
                              })}
                            </div>
                            {member.bars.map((bar) => {
                              const status = STATUS_STYLES[bar.status];
                              return (
                                <Tooltip key={bar.id}>
                                  <TooltipTrigger asChild>
                                    <a
                                      href={`/manager/demandes?q=${encodeURIComponent(bar.reference)}&status=ALL`}
                                      className={`absolute bottom-1 top-1 flex cursor-pointer items-center justify-center overflow-hidden rounded-md px-1 text-[10px] font-medium text-white ring-1 ring-black/5 transition hover:ring-2 hover:ring-foreground/30 ${status.bg}`}
                                      style={{
                                        left: `${((bar.s - 1) / daysInMonth) * 100}%`,
                                        width: `${((bar.e - bar.s + 1) / daysInMonth) * 100}%`,
                                      }}
                                    >
                                      <span className="truncate">{bar.type}</span>
                                    </a>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="space-y-0.5 text-xs">
                                      <div className="font-semibold">{member.name}</div>
                                      <div>
                                        {bar.type} · {bar.days} j. ({String(bar.s).padStart(2, "0")}{" "}
                                        → {String(bar.e).padStart(2, "0")}{" "}
                                        {MONTHS[monthIdx].slice(0, 3)})
                                      </div>
                                      <div className="flex items-center gap-1">
                                        Statut :{" "}
                                        <span
                                          className={`inline-block size-2 rounded-full ${status.bg}`}
                                        />
                                        {bar.statusLabel}
                                      </div>
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                            <div
                              className="pointer-events-none absolute inset-0 z-10 grid gap-px"
                              style={{
                                gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))`,
                              }}
                            >
                              {Array.from({ length: daysInMonth }).map((_, index) => (
                                <div
                                  key={index}
                                  className={nonWorkingDays.has(index + 1) ? "bg-muted/75" : ""}
                                  title={holidaysByDay.get(index + 1)?.name}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                      {filtered.length === 0 && (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          Aucun employé ne correspond aux filtres.
                        </div>
                      )}
                    </div>
                  </TooltipProvider>

                  <div className="mt-3 grid grid-cols-[220px_1fr] items-center gap-2 border-t pt-3">
                    <div className="text-xs font-medium text-muted-foreground">Absents / jour</div>
                    <div
                      className="grid h-10 items-end gap-px"
                      style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))` }}
                    >
                      {coverage.map((value, index) => {
                        const dow = (firstDow + index) % 7;
                        const nonWorking = nonWorkingDays.has(index + 1);
                        const height = value === 0 ? 4 : (value / maxAbsences) * 100;
                        const tone =
                          nonWorking || value === 0
                            ? "bg-muted"
                            : value >= 3
                              ? "bg-stat-red-fg"
                              : value >= 2
                                ? "bg-stat-orange-fg"
                                : "bg-stat-green-fg";
                        return (
                          <div
                            key={index}
                            className={`relative flex items-end ${nonWorking || dow >= 5 ? "opacity-80" : ""}`}
                            title={
                              holidaysByDay.get(index + 1)?.name ??
                              `${index + 1}: ${value} absent(s)`
                            }
                          >
                            <div
                              className={`w-full rounded-sm ${tone}`}
                              style={{ height: `${height}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-2 text-xs">
              <span className="font-medium text-muted-foreground">Statut :</span>
              {Object.values(STATUS_STYLES).map((status) => (
                <span key={status.label} className="flex items-center gap-1.5">
                  <span className={`size-3 rounded ${status.bg}`} />
                  {status.label}
                </span>
              ))}
              <span className="ml-4 font-medium text-muted-foreground">Type :</span>
              {(leaveTypes.length ? leaveTypes : Object.keys(TYPE_DOT)).map((type) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span className={`size-3 rounded ${getTypeDot(type)}`} />
                  {type}
                </span>
              ))}
              <Badge tone="neutral">{stats.teamSize} collaborateur(s)</Badge>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
