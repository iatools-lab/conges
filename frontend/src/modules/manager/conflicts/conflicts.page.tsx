import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Card, CardHeader, Button, Badge, StatCard } from "@/components/ui-kit";
import { AlertTriangle, Users, Calendar, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { toast } from "sonner";

type Severity = "high" | "medium" | "low";
type State = "active" | "resolved" | "ignored" | "report";
type Conflict = {
  id: string;
  severity: Severity;
  period: string;
  periodStart: string;
  periodEnd: string;
  reason: string;
  people: string[];
  type: string;
  state: State;
  resolution?: string | null;
  department: { id: string; code: string; name: string } | null;
  request: { id: string; reference: string; leaveType: string } | null;
  createdAt: string;
  resolvedAt: string | null;
};

type ManagerConflictsResponse = {
  year: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  rows: Conflict[];
  totals: {
    active: number;
    critical: number;
    watch: number;
    resolved: number;
  };
};

type ConflictAction = "resolve" | "ignore" | "postpone";
type ConflictMutationPayload = {
  id: string;
  action: ConflictAction;
  resolution?: string;
  reportPerson?: string;
  reportDate?: string;
};

const sevMap = {
  high: { tone: "rejected", label: "Critique", bar: "bg-stat-red-fg" },
  medium: { tone: "pending", label: "Moyen", bar: "bg-stat-orange-fg" },
  low: { tone: "info", label: "Faible", bar: "bg-stat-blue-fg" },
} as const;

const stateMap = {
  active: { tone: "pending", label: "Actif" },
  resolved: { tone: "valid", label: "Résolu" },
  ignored: { tone: "neutral", label: "Ignoré" },
  report: { tone: "info", label: "Report proposé" },
} as const;

type Filter = "all" | "active" | "critical" | "resolved";

const emptyConflicts: Conflict[] = [];

function buildConflictsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
  });
  appendDateRange(params, range);

  return `/manager/conflicts?${params.toString()}`;
}

export function ManagerConflits() {
  const { ready, session } = useAuthSession();
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [filter, setFilter] = useState<Filter>("all");
  const [resolveTarget, setResolveTarget] = useState<Conflict | null>(null);
  const [resolution, setResolution] = useState("");
  const [reportTarget, setReportTarget] = useState<Conflict | null>(null);
  const [reportPerson, setReportPerson] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [ignoreTarget, setIgnoreTarget] = useState<Conflict | null>(null);

  const queryKey = [
    "manager-conflicts",
    session?.id,
    session?.email,
    ...dateRangeQueryKey(dateRange),
  ];
  const conflictsQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<ManagerConflictsResponse>(buildConflictsPath(session!, dateRange)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const updateConflict = useMutation({
    mutationFn: ({ id, ...payload }: ConflictMutationPayload) =>
      apiFetch<Conflict>(`/manager/conflicts/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          managerId: session!.id,
          managerEmail: session!.email,
          ...payload,
        }),
      }),
    onSuccess: async (conflict, variables) => {
      await queryClient.invalidateQueries({ queryKey });
      if (variables.action === "resolve") toast.success(`Conflit ${conflict.id} résolu`);
      if (variables.action === "postpone") toast.success("Proposition de report enregistrée");
      if (variables.action === "ignore") toast.message(`Conflit ${conflict.id} ignoré`);
      setResolveTarget(null);
      setReportTarget(null);
      setIgnoreTarget(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Action impossible");
    },
  });

  const rows = conflictsQuery.data?.rows ?? emptyConflicts;
  const totals = conflictsQuery.data?.totals ?? { active: 0, critical: 0, watch: 0, resolved: 0 };
  const filtered = useMemo(
    () =>
      rows.filter((conflict) => {
        if (filter === "all") return true;
        if (filter === "active") return conflict.state === "active";
        if (filter === "critical")
          return conflict.state === "active" && conflict.severity === "high";
        if (filter === "resolved") return conflict.state === "resolved";
        return true;
      }),
    [rows, filter],
  );

  const openResolve = (conflict: Conflict) => {
    setResolveTarget(conflict);
    setResolution(conflict.resolution ?? "");
  };
  const openReport = (conflict: Conflict) => {
    setReportTarget(conflict);
    setReportPerson(conflict.people[0] ?? "");
    setReportDate("");
  };

  const confirmResolve = () => {
    if (!resolveTarget) return;
    updateConflict.mutate({ id: resolveTarget.id, action: "resolve", resolution });
  };

  const confirmReport = () => {
    if (!reportTarget) return;
    updateConflict.mutate({
      id: reportTarget.id,
      action: "postpone",
      reportPerson,
      reportDate,
    });
  };

  const confirmIgnore = () => {
    if (!ignoreTarget) return;
    updateConflict.mutate({ id: ignoreTarget.id, action: "ignore" });
  };

  return (
    <AppShell
      title="Conflits d'absence"
      subtitle="Détection automatique des chevauchements et risques de couverture"
    >
      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Conflits actifs" value={totals.active} tone="red" />
        <StatCard label="Critiques" value={totals.critical} tone="red" />
        <StatCard label="À surveiller" value={totals.watch} tone="orange" />
        <StatCard label="Résolus" value={totals.resolved} tone="green" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Conflits détectés (${filtered.length})`}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              {(["all", "active", "critical", "resolved"] as Filter[]).map((filterValue) => (
                <Button
                  key={filterValue}
                  variant={filter === filterValue ? "primary" : "outline"}
                  onClick={() => setFilter(filterValue)}
                >
                  {filterValue === "all"
                    ? "Tous"
                    : filterValue === "active"
                      ? "Actifs"
                      : filterValue === "critical"
                        ? "Critiques"
                        : "Résolus"}
                </Button>
              ))}
            </div>
          }
        />
        <div className="divide-y">
          {conflictsQuery.isLoading && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Chargement des conflits manager...
            </div>
          )}
          {conflictsQuery.isError && (
            <div className="p-10 text-center text-sm text-destructive">
              Impossible de charger les conflits manager.
            </div>
          )}
          {!conflictsQuery.isLoading && !conflictsQuery.isError && filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Aucun conflit correspondant.
            </div>
          )}
          {filtered.map((conflict) => {
            const severity = sevMap[conflict.severity];
            const state = stateMap[conflict.state];
            const closed = conflict.state !== "active";
            return (
              <div key={conflict.id} className="flex gap-4 p-5">
                <div className={`w-1 rounded ${severity.bar}`} />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {closed ? (
                      <CheckCircle2 className="size-4 text-stat-green-fg" />
                    ) : (
                      <AlertTriangle className="size-4 text-stat-red-fg" />
                    )}
                    <span className="font-semibold">{conflict.type}</span>
                    <Badge tone={severity.tone}>{severity.label}</Badge>
                    <Badge tone={state.tone}>{state.label}</Badge>
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      {conflict.period}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3" />
                      {conflict.people.length} employé(s)
                    </span>
                    {conflict.request && <span>{conflict.request.reference}</span>}
                    {conflict.department && <span>{conflict.department.name}</span>}
                  </div>
                  <p className="mb-3 text-sm">{conflict.reason}</p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {conflict.people.map((person) => (
                      <span
                        key={person}
                        className="inline-flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs"
                      >
                        <span className="size-5 rounded-full bg-gradient-to-br from-stat-blue-fg to-stat-purple-fg" />
                        {person}
                      </span>
                    ))}
                  </div>
                  {conflict.resolution && (
                    <p className="mb-3 text-xs italic text-muted-foreground">
                      ↳ {conflict.resolution}
                    </p>
                  )}
                  {!closed && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => openResolve(conflict)}>
                        Résoudre
                      </Button>
                      <Button variant="outline" onClick={() => openReport(conflict)}>
                        Proposer un report
                      </Button>
                      <Button variant="ghost" onClick={() => setIgnoreTarget(conflict)}>
                        Ignorer
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Règles de détection" />
        <div className="grid gap-3 p-5 text-sm md:grid-cols-2">
          {[
            ["Effectif minimum", "Alerte lorsqu'un conflit actif touche le périmètre équipe"],
            ["Profils critiques", "Signalement des demandes liées aux collaborateurs clés"],
            ["Période haute", "Suivi des risques de couverture sur l'année sélectionnée"],
            ["Traçabilité", "Chaque résolution ou report est enregistré en audit"],
          ].map(([title, description]) => (
            <div key={title} className="rounded-lg border p-3">
              <div className="font-medium">{title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{description}</div>
            </div>
          ))}
        </div>
      </Card>

      <Dialog open={!!resolveTarget} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Résoudre le conflit</DialogTitle>
            <DialogDescription>
              {resolveTarget?.type} — {resolveTarget?.period}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <label className="text-xs text-muted-foreground">Note de résolution</label>
            <textarea
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="Ex : renfort temporaire validé avec le département Support…"
              className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveTarget(null)}>
              Annuler
            </Button>
            <Button variant="success" disabled={updateConflict.isPending} onClick={confirmResolve}>
              Marquer comme résolu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reportTarget} onOpenChange={(open) => !open && setReportTarget(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Proposer un report de congé</DialogTitle>
            <DialogDescription>
              {reportTarget?.type} — {reportTarget?.period}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-xs text-muted-foreground">Employé concerné</label>
              {reportTarget?.people.length ? (
                <select
                  value={reportPerson}
                  onChange={(event) => setReportPerson(event.target.value)}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {reportTarget.people.map((person) => (
                    <option key={person}>{person}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={reportPerson}
                  onChange={(event) => setReportPerson(event.target.value)}
                  placeholder="Nom de l'employé concerné"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Nouvelle période proposée</label>
              <input
                type="text"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                placeholder="ex : 22/07/2026 → 28/07/2026"
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportTarget(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={!reportDate || updateConflict.isPending}
              onClick={confirmReport}
            >
              Envoyer la proposition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!ignoreTarget} onOpenChange={(open) => !open && setIgnoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ignorer ce conflit ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le conflit sera masqué de la liste active mais conservé pour audit. Vous pourrez le
              retrouver via le filtre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction disabled={updateConflict.isPending} onClick={confirmIgnore}>
              Ignorer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
