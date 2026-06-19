import { useMemo, useState } from "react";
import type { ReactNode } from "react";
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
import { Card, CardHeader, Button, Badge } from "@/components/ui-kit";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { CalendarOff, ChevronLeft, ChevronRight, Download, Filter } from "lucide-react";

type CalendarLeave = {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  matricule: string;
  department: { id: string; code: string; name: string } | null;
  leaveType: { code: string; label: string };
  status: "draft" | "pending" | "manager" | "rh" | "conflict" | "rejected" | "cancelled";
  statusLabel: string;
  startDate: string;
  endDate: string;
  originalStartDate: string;
  originalEndDate: string;
  days: number;
};

type CalendarHoliday = {
  id: string;
  date: string;
  name: string;
};

type ManagerCalendarResponse = {
  year: number;
  month: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  departments: { id: string; code: string; name: string }[];
  leaveTypes: { code: string; label: string }[];
  summary: {
    teamSize: number;
    periods: number;
    totalDays: number;
    activeConflicts: number;
  };
  holidays: CalendarHoliday[];
  leaves: CalendarLeave[];
};

const MONTH_NAMES = [
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
const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const TYPE_INFO: Record<string, { label: string; cls: string; dot: string }> = {
  CP: { label: "Congés payés", cls: "bg-stat-green text-stat-green-fg", dot: "bg-stat-green-fg" },
  RTT: { label: "RTT", cls: "bg-stat-orange text-stat-orange-fg", dot: "bg-stat-orange-fg" },
  SPE: { label: "Spécial", cls: "bg-stat-purple text-stat-purple-fg", dot: "bg-stat-purple-fg" },
  MAL: { label: "Maladie", cls: "bg-stat-blue text-stat-blue-fg", dot: "bg-stat-blue-fg" },
  SAN: { label: "Sans solde", cls: "bg-stat-yellow text-stat-yellow-fg", dot: "bg-stat-yellow-fg" },
};

const emptyCalendar: ManagerCalendarResponse = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  manager: { id: "", name: "", department: null, managedDepartments: [] },
  departments: [],
  leaveTypes: [],
  summary: { teamSize: 0, periods: 0, totalDays: 0, activeConflicts: 0 },
  holidays: [],
  leaves: [],
};

function buildCalendarPath(
  session: { id: string; email: string },
  range: DateRangeValue,
  year: number,
  month: number,
) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
    year: String(year),
    month: String(month + 1),
  });
  appendDateRange(params, range);

  return `/manager/calendar?${params.toString()}`;
}

function toDayMs(year: number, month: number, day: number) {
  return Date.UTC(year, month, day);
}

function formatDate(value: string) {
  return value.slice(0, 10);
}

function getTypeInfo(code: string, label?: string) {
  return (
    TYPE_INFO[code] ?? {
      label: label ?? code,
      cls: "bg-stat-blue text-stat-blue-fg",
      dot: "bg-stat-blue-fg",
    }
  );
}

function getStatusTone(status: CalendarLeave["status"]) {
  if (status === "rh" || status === "manager") return "valid";
  if (status === "pending") return "pending";
  if (status === "rejected" || status === "cancelled" || status === "conflict") return "rejected";
  return "draft";
}

function exportCalendarCsv(leaves: CalendarLeave[], year: number, month: number) {
  const headers = [
    "Employé",
    "Matricule",
    "Département",
    "Référence",
    "Type",
    "Début",
    "Fin",
    "Jours",
    "Statut",
  ];
  const lines = leaves.map((leave) =>
    [
      leave.employeeName,
      leave.matricule,
      leave.department?.name ?? "Non affecté",
      leave.reference,
      leave.leaveType.label,
      formatDate(leave.originalStartDate),
      formatDate(leave.originalEndDate),
      String(leave.days),
      leave.statusLabel,
    ]
      .map((value) => `"${value.replace(/"/g, '""')}"`)
      .join(";"),
  );
  const csv = [`\uFEFF${headers.join(";")}`, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `manager-calendrier-${year}-${String(month + 1).padStart(2, "0")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ManagerCalendrier() {
  const { ready, session } = useAuthSession();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentMonthRange(today));
  const [dept, setDept] = useState("ALL");
  const [type, setType] = useState("ALL");

  const calendarQuery = useQuery({
    queryKey: [
      "manager-calendar",
      session?.id,
      session?.email,
      year,
      month,
      ...dateRangeQueryKey(dateRange),
    ],
    queryFn: () =>
      apiFetch<ManagerCalendarResponse>(buildCalendarPath(session!, dateRange, year, month)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const data = calendarQuery.data ?? emptyCalendar;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const leaves = useMemo(
    () =>
      data.leaves.filter(
        (leave) =>
          (dept === "ALL" || leave.department?.code === dept) &&
          (type === "ALL" || leave.leaveType.code === type),
      ),
    [data.leaves, dept, type],
  );
  const holidaysByDate = useMemo(
    () => new Map(data.holidays.map((holiday) => [holiday.date, holiday])),
    [data.holidays],
  );

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarLeave[]>();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const current = toDayMs(year, month, day);
      const currentDate = new Date(current);
      const isWeekend = currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6;
      const isHoliday = holidaysByDate.has(currentDate.toISOString().slice(0, 10));
      map.set(
        day,
        isWeekend || isHoliday
          ? []
          : leaves.filter((leave) => {
              const start = new Date(leave.startDate).getTime();
              const end = new Date(leave.endDate).getTime();
              return current >= start && current <= end;
            }),
      );
    }
    return map;
  }, [daysInMonth, holidaysByDate, leaves, month, year]);

  const strongAbsenceDays = useMemo(
    () =>
      Array.from(byDay.entries())
        .filter(([, dayLeaves]) => dayLeaves.length >= 2)
        .sort((left, right) => right[1].length - left[1].length)
        .slice(0, 5),
    [byDay],
  );
  const upcomingReturns = useMemo(
    () =>
      [...leaves]
        .sort((left, right) => new Date(left.endDate).getTime() - new Date(right.endDate).getTime())
        .slice(0, 4),
    [leaves],
  );

  const applyDateRange = (nextRange: DateRangeValue) => {
    setDateRange(nextRange);
    if (nextRange.dateFrom) {
      setYear(dateRangeYear(nextRange, today.getFullYear()));
      setMonth(dateRangeMonthIndex(nextRange, today.getMonth()));
    }
  };

  const goPrev = () => {
    const nextMonth = month === 0 ? 11 : month - 1;
    const nextYear = month === 0 ? year - 1 : year;
    setMonth(nextMonth);
    setYear(nextYear);
    setDateRange(monthRange(nextYear, nextMonth));
  };
  const goNext = () => {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    setMonth(nextMonth);
    setYear(nextYear);
    setDateRange(monthRange(nextYear, nextMonth));
  };
  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setDateRange(monthRange(today.getFullYear(), today.getMonth()));
  };

  return (
    <AppShell title="Calendrier d'équipe" subtitle="Vue mensuelle des absences de votre équipe">
      <Card>
        <CardHeader
          title={`${MONTH_NAMES[month]} ${year}`}
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
              <Button variant="outline" onClick={goToday}>
                Aujourd'hui
              </Button>
              <Button variant="outline" className="!p-2" onClick={goNext} aria-label="Mois suivant">
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="outline" onClick={() => exportCalendarCsv(leaves, year, month)}>
                <Download className="size-4" /> Exporter
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-3 border-b p-4 text-sm">
          <Filter className="size-4 text-muted-foreground" />
          <DateRangeFilter value={dateRange} onChange={applyDateRange} compact />
          <select
            className="rounded-md border bg-background px-2 py-1.5"
            value={month}
            onChange={(event) => {
              const nextMonth = Number(event.target.value);
              setMonth(nextMonth);
              setDateRange(monthRange(year, nextMonth));
            }}
          >
            {MONTH_NAMES.map((monthName, index) => (
              <option key={monthName} value={index}>
                {monthName}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border bg-background px-2 py-1.5"
            value={year}
            onChange={(event) => {
              const nextYear = Number(event.target.value);
              setYear(nextYear);
              setDateRange(monthRange(nextYear, month));
            }}
          >
            {[2025, 2026, 2027].map((yearOption) => (
              <option key={yearOption} value={yearOption}>
                {yearOption}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border bg-background px-2 py-1.5"
            value={dept}
            onChange={(event) => setDept(event.target.value)}
          >
            <option value="ALL">Tous départements</option>
            {data.departments.map((department) => (
              <option key={department.code} value={department.code}>
                {department.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border bg-background px-2 py-1.5"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="ALL">Tous types</option>
            {data.leaveTypes.map((leaveType) => (
              <option key={leaveType.code} value={leaveType.code}>
                {leaveType.label}
              </option>
            ))}
          </select>
          <div className="ml-auto flex flex-wrap gap-3 text-xs">
            {(data.leaveTypes.length
              ? data.leaveTypes
              : Object.entries(TYPE_INFO).map(([code, info]) => ({ code, label: info.label }))
            ).map((leaveType) => {
              const info = getTypeInfo(leaveType.code, leaveType.label);
              return (
                <span key={leaveType.code} className="flex items-center gap-1.5">
                  <span className={`size-3 rounded ${info.dot}`} />
                  {leaveType.label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="p-5">
          {calendarQuery.isLoading ? (
            <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              Chargement du calendrier d'équipe...
            </div>
          ) : calendarQuery.isError ? (
            <div className="rounded-md border border-destructive/30 py-12 text-center text-sm text-destructive">
              Impossible de charger le calendrier manager.
            </div>
          ) : (
            <div className="grid grid-cols-7 overflow-hidden rounded-lg border bg-border">
              {DOW.map((dayName) => (
                <div
                  key={dayName}
                  className="bg-muted/60 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {dayName}
                </div>
              ))}
              {Array.from({ length: totalCells }).map((_, index) => {
                const dayNum = index - startDow + 1;
                const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                const dow = index % 7;
                const isWeekend = dow === 5 || dow === 6;
                const dateKey = inMonth
                  ? new Date(Date.UTC(year, month, dayNum)).toISOString().slice(0, 10)
                  : "";
                const holiday = holidaysByDate.get(dateKey);
                const isToday =
                  inMonth &&
                  dayNum === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear();
                const list = inMonth ? (byDay.get(dayNum) ?? []) : [];
                return (
                  <div
                    key={index}
                    className={`flex min-h-[110px] flex-col border-r border-t border-border bg-card p-1.5 text-xs ${
                      !inMonth ? "bg-muted/30 text-muted-foreground/40" : ""
                    } ${(isWeekend || holiday) && inMonth ? "bg-muted/40" : ""}`}
                    title={holiday?.name}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`inline-flex size-6 items-center justify-center rounded-full text-[11px] font-medium ${
                          isToday ? "bg-navy text-navy-foreground" : ""
                        }`}
                      >
                        {inMonth ? dayNum : ""}
                      </span>
                      {inMonth && list.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {list.length}/{Math.max(1, data.summary.teamSize)}
                        </span>
                      )}
                    </div>
                    {holiday && (
                      <div className="mb-1 flex items-center gap-1 truncate text-[10px] font-medium text-destructive">
                        <CalendarOff className="size-3 shrink-0" />
                        <span className="truncate">{holiday.name}</span>
                      </div>
                    )}
                    <div className="flex-1 space-y-0.5 overflow-hidden">
                      {list.slice(0, 3).map((leave) => {
                        const typeInfo = getTypeInfo(leave.leaveType.code, leave.leaveType.label);
                        return (
                          <TooltipProvider key={leave.id} delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className={`cursor-default truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${typeInfo.cls}`}
                                >
                                  {leave.employeeName.split(" ")[0]}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-0.5 text-xs">
                                  <div className="font-semibold">{leave.employeeName}</div>
                                  <div className="text-muted-foreground">
                                    {leave.leaveType.label}
                                  </div>
                                  <div className="text-muted-foreground">
                                    {formatDate(leave.originalStartDate)} →{" "}
                                    {formatDate(leave.originalEndDate)}
                                  </div>
                                  <Badge tone={getStatusTone(leave.status)}>
                                    {leave.statusLabel}
                                  </Badge>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                      {list.length > 3 && (
                        <div className="px-1 text-[10px] text-muted-foreground">
                          +{list.length - 3} autres
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Synthèse du mois" />
          <div className="space-y-3 p-5 text-sm">
            <Line k="Effectif suivi" v={`${data.summary.teamSize} collaborateurs`} />
            <Line k="Absences totales" v={`${leaves.length} périodes`} />
            <Line k="Jours planifiés" v={`${data.summary.totalDays} jours`} />
            <Line
              k="Seuil minimum"
              v={
                data.summary.activeConflicts > 0 ? (
                  <Badge tone="rejected">À surveiller</Badge>
                ) : (
                  <Badge tone="valid">Respecté</Badge>
                )
              }
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Jours à forte absence" />
          <div className="space-y-2 p-5 text-sm">
            {strongAbsenceDays.length ? (
              strongAbsenceDays.map(([day, dayLeaves]) => (
                <div key={day} className="flex justify-between border-b py-1.5 last:border-0">
                  <span>
                    {String(day).padStart(2, "0")} {MONTH_NAMES[month].slice(0, 3).toLowerCase()}.
                  </span>
                  <span className="text-muted-foreground">{dayLeaves.length} absents</span>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Aucun pic d'absence détecté.</div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Prochains retours" />
          <div className="space-y-2 p-5 text-sm">
            {upcomingReturns.length ? (
              upcomingReturns.map((leave) => (
                <div
                  key={leave.id}
                  className="flex justify-between gap-3 border-b py-1.5 last:border-0"
                >
                  <span className="min-w-0 truncate">{leave.employeeName}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatDate(leave.originalEndDate)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">Aucun retour planifié ce mois.</div>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-semibold">{v}</span>
    </div>
  );
}
