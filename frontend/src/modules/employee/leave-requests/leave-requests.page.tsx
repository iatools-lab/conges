import { AppShell } from "@/components/AppShell";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, Button, Card, CardHeader } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { useMemo, useState } from "react";

type CalendarStatus = "draft" | "pending" | "valid" | "rejected" | "neutral" | "planned" | "review";

type DepartmentPlan = {
  id: string;
  reference: string;
  debut: string;
  fin: string;
  startDate: string;
  endDate: string;
  jours: number;
  type: string;
  typeLabel: string;
  status: CalendarStatus;
  label: string;
  employee: {
    id: string;
    name: string;
    poste: string;
    department: { id: string; code: string; name: string } | null;
  };
};

type DepartmentPlanningResponse = {
  year: number;
  department: { id: string; code: string; name: string } | null;
  plans: DepartmentPlan[];
};

const emptyPlans: DepartmentPlan[] = [];

const MONTHS_FR = [
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

const STATUS_STYLES: Record<CalendarStatus, string> = {
  draft: "bg-status-draft text-status-draft-fg",
  pending: "bg-status-pending text-status-pending-fg",
  valid: "bg-stat-green text-stat-green-fg",
  rejected: "bg-status-rejected text-status-rejected-fg",
  neutral: "bg-muted text-muted-foreground",
  planned: "bg-stat-yellow text-stat-yellow-fg",
  review: "bg-stat-orange text-stat-orange-fg",
};

const STATUS_FILTERS: Array<{ status: CalendarStatus; label: string }> = [
  { status: "planned", label: "Planifié" },
  { status: "pending", label: "Soumis" },
  { status: "review", label: "En revue" },
  { status: "valid", label: "Confirmé" },
  { status: "rejected", label: "Rejeté" },
  { status: "neutral", label: "Annulé" },
  { status: "draft", label: "Brouillon" },
];

function buildDepartmentPlanningPath(
  session: { id: string; email: string },
  range: DateRangeValue,
) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
  });
  appendDateRange(params, range);

  return `/employee/planning/department?${params.toString()}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function firstWeekday(year: number, month: number) {
  const day = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return (day + 6) % 7;
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function planCoversDay(plan: DepartmentPlan, year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return toDate(plan.startDate) <= date && date <= toDate(plan.endDate);
}

function planOverlapsMonth(plan: DepartmentPlan, year: number, month: number) {
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  return toDate(plan.startDate) <= monthEnd && toDate(plan.endDate) >= monthStart;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function MonthCalendar({
  year,
  month,
  plans,
}: {
  year: number;
  month: number;
  plans: DepartmentPlan[];
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
                    title={`${plan.employee.name} · ${plan.typeLabel}`}
                  >
                    {plan.employee.name} · {plan.type}
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
}: {
  year: number;
  month: number;
  plans: DepartmentPlan[];
}) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, index) => index + 1),
  ];

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">{MONTHS_FR[month]}</span>
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
    </div>
  );
}

function StatusFilterRow({
  selected,
  onToggle,
}: {
  selected: CalendarStatus[];
  onToggle: (status: CalendarStatus) => void;
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

export function Demandes() {
  const { session } = useAuthSession();
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange(today));
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedStatuses, setSelectedStatuses] = useState<CalendarStatus[]>(
    STATUS_FILTERS.map((item) => item.status),
  );

  const calendarQuery = useQuery({
    queryKey: [
      "employee-department-calendar",
      session?.id,
      session?.email,
      ...dateRangeQueryKey(dateRange),
    ],
    queryFn: () =>
      apiFetch<DepartmentPlanningResponse>(buildDepartmentPlanningPath(session!, dateRange)),
    enabled: Boolean(session?.id && session?.email),
  });

  const plans = calendarQuery.data?.plans ?? emptyPlans;
  const filteredPlans = useMemo(
    () => plans.filter((plan) => selectedStatuses.includes(plan.status)),
    [plans, selectedStatuses],
  );
  const monthPlans = useMemo(
    () => filteredPlans.filter((plan) => planOverlapsMonth(plan, year, month)),
    [filteredPlans, month, year],
  );

  const toggleStatus = (status: CalendarStatus) => {
    setSelectedStatuses((current) => {
      if (current.includes(status)) {
        if (current.length === 1) return current;
        return current.filter((value) => value !== status);
      }
      return [...current, status];
    });
  };

  const departmentName =
    calendarQuery.data?.department?.name ?? session?.department?.name ?? "votre équipe";
  const peopleCount = new Set(plans.map((plan) => plan.employee.id)).size;

  const applyDateRange = (nextRange: DateRangeValue) => {
    setDateRange(nextRange);
    if (nextRange.dateFrom) {
      setYear(dateRangeYear(nextRange, today.getFullYear()));
      setMonth(dateRangeMonthIndex(nextRange, today.getMonth()));
    }
  };

  const goPrevMonth = () => {
    const nextMonth = month === 0 ? 11 : month - 1;
    const nextYear = month === 0 ? year - 1 : year;
    setYear(nextYear);
    setMonth(nextMonth);
    setDateRange(monthRange(nextYear, nextMonth));
  };

  const goNextMonth = () => {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    setYear(nextYear);
    setMonth(nextMonth);
    setDateRange(monthRange(nextYear, nextMonth));
  };

  return (
    <AppShell title="Calendrier équipe" subtitle={`Planifications de ${departmentName}`}>
      {calendarQuery.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Impossible de charger le calendrier de l'équipe. {calendarQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      <DateRangeFilter value={dateRange} onChange={applyDateRange} className="mb-4" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Département</div>
          <div className="mt-2 text-xl font-semibold">{departmentName}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Collaborateurs visibles</div>
          <div className="mt-2 flex items-center gap-2 text-xl font-semibold">
            <Users className="size-5 text-muted-foreground" />
            {peopleCount}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Planifications année</div>
          <div className="mt-2 text-xl font-semibold">{plans.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Jours planifiés (mois)</div>
          <div className="mt-2 text-xl font-semibold">
            {formatNumber(monthPlans.reduce((sum, plan) => sum + plan.jours, 0))}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="mensuel" className="mt-6 w-full">
        <TabsList className="bg-muted">
          <TabsTrigger value="mensuel">Planification mensuelle</TabsTrigger>
          <TabsTrigger value="annuel">Planification annuelle</TabsTrigger>
        </TabsList>

        <TabsContent value="mensuel" className="mt-4">
          <Card className="mb-4 p-4">
            <div className="mb-2 text-sm font-medium">Filtrer par statut</div>
            <StatusFilterRow selected={selectedStatuses} onToggle={toggleStatus} />
          </Card>

          <Card>
            <CardHeader
              title={`${MONTHS_FR[month]} ${year}`}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="!p-2"
                    onClick={goPrevMonth}
                    aria-label="Mois précédent"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMonth(today.getMonth());
                      setYear(today.getFullYear());
                      setDateRange(monthRange(today.getFullYear(), today.getMonth()));
                    }}
                  >
                    Aujourd'hui
                  </Button>
                  <Button
                    variant="outline"
                    className="!p-2"
                    onClick={goNextMonth}
                    aria-label="Mois suivant"
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              }
            />
            <div className="p-5">
              {calendarQuery.isLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Chargement du calendrier...
                </div>
              ) : (
                <MonthCalendar year={year} month={month} plans={filteredPlans} />
              )}
            </div>
          </Card>

          <Card className="mt-4 overflow-hidden">
            <CardHeader title={`Planifications du mois (${monthPlans.length})`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Collaborateur</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {calendarQuery.isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                        Chargement des planifications...
                      </td>
                    </tr>
                  ) : monthPlans.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                        Aucune planification pour ce mois.
                      </td>
                    </tr>
                  ) : (
                    monthPlans.map((plan) => (
                      <tr key={plan.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3">
                          <div className="font-medium">{plan.employee.name}</div>
                          <div className="text-xs text-muted-foreground">{plan.employee.poste}</div>
                        </td>
                        <td className="px-5 py-3">{plan.typeLabel}</td>
                        <td className="px-5 py-3">
                          {plan.debut} → {plan.fin}
                        </td>
                        <td className="px-5 py-3">{formatNumber(plan.jours)}</td>
                        <td className="px-5 py-3">
                          <Badge tone={plan.status}>{plan.label}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="annuel" className="mt-4">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold">
                <CalendarDays className="size-5" /> Vue annuelle {year}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="!p-2"
                  onClick={() => {
                    const nextYear = year - 1;
                    setYear(nextYear);
                    setDateRange(yearRange(nextYear));
                  }}
                  aria-label="Année précédente"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="!p-2"
                  onClick={() => {
                    const nextYear = year + 1;
                    setYear(nextYear);
                    setDateRange(yearRange(nextYear));
                  }}
                  aria-label="Année suivante"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
            <div className="mb-4">
              <StatusFilterRow selected={selectedStatuses} onToggle={toggleStatus} />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 12 }, (_, monthIndex) => (
                <MonthMini key={monthIndex} year={year} month={monthIndex} plans={filteredPlans} />
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
