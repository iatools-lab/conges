import { AppShell } from "@/components/AppShell";
import { RowActions } from "@/components/RowActions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  dateRangeYear,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, Eye, Search } from "lucide-react";
import { useMemo, useState } from "react";

type Status = "valid" | "pending" | "rejected" | "draft" | "neutral";
type HistoryRow = {
  id: string;
  reference: string;
  date: string;
  requestedBy: string;
  requestedAt: string;
  type: string;
  period: string;
  days: number;
  status: Status;
  statusLabel: string;
  validator: string;
  decision: string;
  validatedAt: string | null;
  note: string;
};

type EmployeeHistoryResponse = {
  year: number;
  rows: HistoryRow[];
  stats: {
    total: number;
    valid: number;
    rejected: number;
    pending: number;
    daysTaken: number;
    entitlement: number;
  };
};

const emptyRows: HistoryRow[] = [];

function buildHistoryPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
  });
  appendDateRange(params, range);

  return `/employee/history?${params.toString()}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

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
    "Référence",
    "Demandé par",
    "Date et heure demande",
    "Type",
    "Période",
    "Jours",
    "Statut",
    "Validateur",
    "Date et heure validation",
    "Décision",
    "Note",
  ];
  const lines = rows.map((row) =>
    [
      row.reference,
      row.requestedBy,
      formatDateTime(row.requestedAt),
      row.type,
      row.period,
      String(row.days),
      row.statusLabel,
      row.validator,
      formatDateTime(row.validatedAt),
      row.decision,
      row.note,
    ]
      .map((value) => `"${value.replace(/"/g, '""')}"`)
      .join(";"),
  );
  const csv = [`\uFEFF${headers.join(";")}`, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `historique-conges-${year}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function HistoriquePage() {
  const { session } = useAuthSession();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState<HistoryRow | null>(null);
  const year = dateRangeYear(dateRange);

  const historyQuery = useQuery({
    queryKey: ["employee-history", session?.id, session?.email, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<EmployeeHistoryResponse>(buildHistoryPath(session!, dateRange)),
    enabled: !!session,
  });

  const rows = historyQuery.data?.rows ?? emptyRows;
  const stats = historyQuery.data?.stats;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!needle) return true;
      return [row.reference, row.requestedBy, row.type, row.period, row.validator, row.statusLabel]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, rows, status]);

  return (
    <AppShell title="Historique" subtitle="Toutes vos demandes de congés depuis votre arrivée">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Demandes total"
          value={String(stats?.total ?? 0)}
          suffix={String(year)}
          tone="blue"
        />
        <StatCard label="Validées" value={String(stats?.valid ?? 0)} tone="green" />
        <StatCard label="Refusées" value={String(stats?.rejected ?? 0)} tone="red" />
        <StatCard
          label={`Jours pris (${year})`}
          value={String(stats?.daysTaken ?? 0)}
          suffix={`sur ${stats?.entitlement ?? 0}`}
          tone="purple"
        />
      </div>

      {historyQuery.isError && (
        <Alert variant="destructive" className="mt-4">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Impossible de charger l'historique. {historyQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Mes demandes"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Rechercher…"
                  className="pl-8 pr-3 py-2 text-sm border rounded-md bg-card w-56"
                />
              </div>
              <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="border rounded-md px-3 py-2 text-sm bg-card"
              >
                <option value="all">Tous statuts</option>
                <option value="valid">Validées</option>
                <option value="pending">En attente</option>
                <option value="rejected">Refusées</option>
                <option value="draft">Brouillons</option>
                <option value="neutral">Annulées</option>
              </select>
              <Button variant="outline" onClick={() => exportHistoryCsv(filtered, year)}>
                <Download className="size-4" /> Export
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                <th className="text-left px-5 py-3 font-medium">Référence</th>
                <th className="text-left px-3 py-3 font-medium">Demandé par</th>
                <th className="text-left px-3 py-3 font-medium">Date/heure demande</th>
                <th className="text-left px-3 py-3 font-medium">Type</th>
                <th className="text-left px-3 py-3 font-medium">Période</th>
                <th className="text-right px-3 py-3 font-medium">Jours</th>
                <th className="text-left px-3 py-3 font-medium">Statut</th>
                <th className="text-left px-3 py-3 font-medium">Validateur</th>
                <th className="text-left px-3 py-3 font-medium">Date/heure validation</th>
                <th className="text-right px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {historyQuery.isLoading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                    Chargement de l'historique...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-muted-foreground">
                    Aucune demande ne correspond aux filtres.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{row.reference}</td>
                    <td className="px-3 py-3 text-muted-foreground">{row.requestedBy}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDateTime(row.requestedAt)}
                    </td>
                    <td className="px-3 py-3 font-medium">{row.type}</td>
                    <td className="px-3 py-3 text-muted-foreground">{row.period}</td>
                    <td className="px-3 py-3 text-right font-medium">{row.days}</td>
                    <td className="px-3 py-3">
                      <Badge tone={row.status}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{row.validator}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDateTime(row.validatedAt)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RowActions
                        label={`la demande ${row.reference}`}
                        actions={[
                          {
                            label: "Voir détails",
                            icon: Eye,
                            onSelect: () => setDetail(row),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t text-xs text-muted-foreground">
          <span>{filtered.length} demande(s) affichée(s)</span>
          <span>{dateRange.dateFrom || "Tout"} - {dateRange.dateTo || "Tout"}</span>
        </div>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Détail · {detail?.reference}</DialogTitle>
            <DialogDescription>Historique de la demande.</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Demandé par" value={detail.requestedBy} />
              <Info label="Date demande" value={formatDateTime(detail.requestedAt)} />
              <Info label="Type" value={detail.type} />
              <Info label="Période" value={detail.period} />
              <Info label="Jours" value={String(detail.days)} />
              <Info label="Statut" value={detail.statusLabel} />
              <Info label="Validateur" value={detail.validator} />
              <Info label="Date validation" value={formatDateTime(detail.validatedAt)} />
              <Info label="Décision" value={detail.decision} />
              <Info label="Note" value={detail.note} />
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}
