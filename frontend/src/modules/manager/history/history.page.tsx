import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  dateRangeYear,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Card, CardHeader, Button, Badge, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { Search, Download } from "lucide-react";

type Decision = "valid" | "rejected" | "pending";

type HistoryRow = {
  id: string;
  date: string;
  emp: string;
  matricule: string;
  department: { id: string; code: string; name: string } | null;
  validator: string;
  validatorDepartment: { id: string; code: string; name: string } | null;
  type: string;
  period: string;
  days: number;
  decision: Decision;
  note: string;
  reference: string;
  requestId: string;
};

type ManagerHistoryResponse = {
  year: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  rows: HistoryRow[];
  totals: {
    month: number;
    valid: number;
    rejected: number;
    pending: number;
    averageDelay: number;
  };
};

const decisionLabel: Record<Decision, string> = {
  valid: "Validée",
  rejected: "Refusée",
  pending: "À revoir",
};

const emptyRows: HistoryRow[] = [];
const emptyHistory: ManagerHistoryResponse = {
  year: new Date().getFullYear(),
  manager: { id: "", name: "", department: null, managedDepartments: [] },
  rows: emptyRows,
  totals: { month: 0, valid: 0, rejected: 0, pending: 0, averageDelay: 0 },
};

function buildHistoryPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
  });
  appendDateRange(params, range);

  return `/manager/history?${params.toString()}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function exportHistoryCsv(rows: HistoryRow[], year: number) {
  const headers = [
    "Date décision",
    "Employé",
    "Matricule",
    "Département",
    "Manager validateur",
    "Département manager",
    "Référence",
    "Type",
    "Période",
    "Jours",
    "Décision",
    "Commentaire",
  ];
  const lines = rows.map((row) =>
    [
      formatDateTime(row.date),
      row.emp,
      row.matricule,
      row.department?.name ?? "Non affecté",
      row.validator,
      row.validatorDepartment?.name ?? "Non affecté",
      row.reference,
      row.type,
      row.period,
      String(row.days),
      decisionLabel[row.decision],
      row.note,
    ]
      .map((value) => `"${value.replace(/"/g, '""')}"`)
      .join(";"),
  );
  const csv = [`\uFEFF${headers.join(";")}`, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `manager-historique-${year}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ManagerHistorique() {
  const { ready, session } = useAuthSession();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const exportYear = dateRangeYear(dateRange);
  const [query, setQuery] = useState("");
  const [decision, setDecision] = useState<"ALL" | Decision>("ALL");
  const [department, setDepartment] = useState("ALL");

  const historyQuery = useQuery({
    queryKey: ["manager-history", session?.id, session?.email, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<ManagerHistoryResponse>(buildHistoryPath(session!, dateRange)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const data = historyQuery.data ?? emptyHistory;
  const rows = data.rows ?? emptyRows;
  const departments = useMemo(() => {
    const byCode = new Map<string, { code: string; name: string }>();
    rows.forEach((row) => {
      if (row.department) byCode.set(row.department.code, row.department);
    });

    return Array.from(byCode.values()).sort((left, right) => left.name.localeCompare(right.name));
  }, [rows]);
  const filtered = useMemo(() => {
    const searchText = query.trim().toLowerCase();
    return rows.filter((row) => {
      const decisionMatches = decision === "ALL" || row.decision === decision;
      const departmentMatches = department === "ALL" || row.department?.code === department;
      const searchMatches =
        !searchText ||
        row.emp.toLowerCase().includes(searchText) ||
        row.validator.toLowerCase().includes(searchText) ||
        (row.department?.name ?? "").toLowerCase().includes(searchText) ||
        row.matricule.toLowerCase().includes(searchText) ||
        row.reference.toLowerCase().includes(searchText);

      return decisionMatches && departmentMatches && searchMatches;
    });
  }, [rows, query, decision, department]);

  return (
    <AppShell
      title="Historique des validations"
      subtitle="Toutes les décisions prises sur les demandes de l'équipe"
    >
      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Décisions ce mois" value={data.totals.month} tone="blue" />
        <StatCard label="Validées" value={data.totals.valid} tone="green" />
        <StatCard label="Refusées" value={data.totals.rejected} tone="red" />
        <StatCard label="Délai moyen" value={`${data.totals.averageDelay}j`} tone="purple" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Décisions récentes"
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher un employé…"
                  className="w-64 rounded-md border bg-card py-2 pl-8 pr-3 text-sm"
                />
              </div>
              <select
                className="rounded-md border bg-card px-3 py-2 text-sm"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                <option value="ALL">Tous départements</option>
                {departments.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border bg-card px-3 py-2 text-sm"
                value={decision}
                onChange={(event) => setDecision(event.target.value as never)}
              >
                <option value="ALL">Toutes décisions</option>
                <option value="valid">Validées</option>
                <option value="rejected">Refusées</option>
                <option value="pending">À revoir</option>
              </select>
              <Button variant="outline" onClick={() => exportHistoryCsv(filtered, exportYear)}>
                <Download className="size-4" /> Export CSV
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="px-5 py-3 text-left font-medium">Date décision</th>
                <th className="px-3 py-3 text-left font-medium">Employé</th>
                <th className="px-3 py-3 text-left font-medium">Validateur</th>
                <th className="px-3 py-3 text-left font-medium">Type</th>
                <th className="px-3 py-3 text-left font-medium">Période</th>
                <th className="px-3 py-3 text-right font-medium">Jours</th>
                <th className="px-3 py-3 text-left font-medium">Décision</th>
                <th className="px-3 py-3 text-left font-medium">Commentaire</th>
                <th className="px-5 py-3 text-left font-medium">Référence</th>
              </tr>
            </thead>
            <tbody>
              {historyQuery.isLoading && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                    Chargement de l'historique manager...
                  </td>
                </tr>
              )}
              {historyQuery.isError && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-destructive">
                    Impossible de charger l'historique manager.
                  </td>
                </tr>
              )}
              {!historyQuery.isLoading && !historyQuery.isError && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                    Aucune décision ne correspond aux filtres.
                  </td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-muted-foreground">{formatDateTime(row.date)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="size-7 rounded-full bg-gradient-to-br from-stat-blue-fg to-stat-purple-fg" />
                      <div>
                        <div className="font-medium">{row.emp}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.department?.name ?? "Non affecté"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{row.validator}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.validatorDepartment?.name ?? "Non affecté"}
                    </div>
                  </td>
                  <td className="px-3 py-3">{row.type}</td>
                  <td className="px-3 py-3 text-muted-foreground">{row.period}</td>
                  <td className="px-3 py-3 text-right font-medium">{row.days}</td>
                  <td className="px-3 py-3">
                    <Badge tone={row.decision}>{decisionLabel[row.decision]}</Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{row.note}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{row.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
          <span>{filtered.length} décision(s) affichée(s)</span>
          <span>Année {data.year}</span>
        </div>
      </Card>
    </AppShell>
  );
}
