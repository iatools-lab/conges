import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { AlertCircle, Check, Download, Eye, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { toast } from "sonner";

type ReqStatus = "pending" | "revision" | "valid" | "rejected";
type Decision = "approve" | "reject" | "review";

type ManagerRequest = {
  id: string;
  reference: string;
  emp: string;
  employeeName: string;
  matricule: string;
  poste: string;
  dept: string;
  departmentName: string;
  type: string;
  typeCode: string;
  debut: string;
  fin: string;
  startDate: string;
  endDate: string;
  jours: number;
  solde: number;
  status: ReqStatus;
  statusCode: string;
  statusLabel: string;
  canDecide: boolean;
  motif: string;
  envoyee: string;
  submittedAt: string | null;
};

type ManagerRequestsResponse = {
  year: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  rows: ManagerRequest[];
  totals: {
    total: number;
    pending: number;
    revision: number;
    valid: number;
    rejected: number;
  };
};

type TeamPlan = {
  id: string;
  matricule: string;
  name: string;
  dept: string;
  departmentName: string;
  role: string;
  soumis: boolean;
  plan: number[];
  total: number;
  requests: Array<{
    id: string;
    reference: string;
    startDate: string;
    endDate: string;
    days: number;
    type: string;
    typeCode: string;
    status:
      | "DRAFT"
      | "PENDING"
      | "IN_REVIEW"
      | "APPROVED"
      | "REJECTED"
      | "CANCELLED";
  }>;
};

type ManagerPlanningResponse = {
  year: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  team: TeamPlan[];
  stats: {
    soumis: number;
    total: number;
    brouillon: number;
    jours: number;
    taux: number;
  };
};

type ProcessedFilter = "ALL" | Exclude<ReqStatus, "pending">;

const emptyRows: ManagerRequest[] = [];
const emptyTotals: ManagerRequestsResponse["totals"] = {
  total: 0,
  pending: 0,
  revision: 0,
  valid: 0,
  rejected: 0,
};

const emptyPlanning: ManagerPlanningResponse = {
  year: new Date().getFullYear(),
  manager: { id: "", name: "", department: null, managedDepartments: [] },
  team: [],
  stats: { soumis: 0, total: 0, brouillon: 0, jours: 0, taux: 100 },
};


const statusMap: Record<
  ReqStatus,
  { tone: "pending" | "valid" | "rejected" | "draft" | "review"; label: string }
> = {
  pending: { tone: "pending", label: "En attente" },
  revision: { tone: "review", label: "En revue" },
  valid: { tone: "valid", label: "Validée" },
  rejected: { tone: "rejected", label: "Refusée" },
};

const decisionLabels: Record<Decision, string> = {
  approve: "validée et transmise RH",
  review: "renvoyée pour revue",
  reject: "refusée",
};

function buildRequestsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
  });
  appendDateRange(params, range);

  return `/manager/requests?${params.toString()}`;
}

function buildPlanningPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
  });
  appendDateRange(params, range);

  return `/manager/planning?${params.toString()}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function planningStatus(status: TeamPlan["requests"][number]["status"]) {
  if (status === "DRAFT") return { tone: "draft" as const, label: "Planifié" };
  if (status === "PENDING") return { tone: "pending" as const, label: "Soumis" };
  if (status === "IN_REVIEW") return { tone: "review" as const, label: "En revue" };
  if (status === "APPROVED") return { tone: "valid" as const, label: "Validé" };
  if (status === "REJECTED") return { tone: "rejected" as const, label: "Refusé" };
  return { tone: "neutral" as const, label: "Annulé" };
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportHistoryRowCsv(row: ManagerRequest) {
  const headers = [
    "Date",
    "Référence",
    "Employé",
    "Département",
    "Type",
    "Période",
    "Jours",
    "Statut",
    "Motif",
  ];
  const values = [
    row.envoyee,
    row.reference,
    row.employeeName,
    row.departmentName,
    row.type,
    `${row.debut} -> ${row.fin}`,
    formatNumber(row.jours),
    row.statusLabel,
    row.motif,
  ];
  const csv = [headers, values].map((line) => line.map((cell) => escapeCsvValue(cell)).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `historique-${row.reference}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function readInitialFilters() {
  if (typeof window === "undefined") {
    return { search: "", status: "pending" as "ALL" | ReqStatus };
  }

  const params = new URLSearchParams(window.location.search);
  const query = params.get("q")?.trim() ?? "";
  const status = params.get("status");
  const safeStatus: "ALL" | ReqStatus =
    status === "ALL" || status === "pending" || status === "revision" || status === "valid" || status === "rejected"
      ? status
      : "pending";

  return { search: query, status: safeStatus };
}

export function ManagerDemandes() {
  const queryClient = useQueryClient();
  const { ready, session } = useAuthSession();
  const initialFilters = useMemo(readInitialFilters, []);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [tab, setTab] = useState<"pending" | "planning" | "history">("pending");
  const [department, setDepartment] = useState("ALL");
  const [search, setSearch] = useState(initialFilters.search);
  const [typeF, setTypeF] = useState("ALL");
  const [statusF, setStatusF] = useState<"ALL" | ReqStatus>(initialFilters.status);
  const [processedFilter, setProcessedFilter] = useState<ProcessedFilter>("ALL");
  const [detail, setDetail] = useState<ManagerRequest | null>(null);
  const [decisionDialog, setDecisionDialog] = useState<{
    request: ManagerRequest;
    decision: Extract<Decision, "reject" | "review">;
  } | null>(null);
  const [decisionComment, setDecisionComment] = useState("");

  const requestsQuery = useQuery({
    queryKey: ["manager-requests", session?.id, session?.email, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<ManagerRequestsResponse>(buildRequestsPath(session!, dateRange)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const planningQuery = useQuery({
    queryKey: ["manager-planning", session?.id, session?.email, ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<ManagerPlanningResponse>(buildPlanningPath(session!, dateRange)),
    enabled: ready && !!session?.id && !!session?.email && tab === "planning",
  });

  const rows = requestsQuery.data?.rows ?? emptyRows;
  const totals = requestsQuery.data?.totals ?? emptyTotals;
  const planningData = planningQuery.data ?? emptyPlanning;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (department === "ALL" || row.dept === department) &&
        (statusF === "ALL" || row.status === statusF) &&
        (typeF === "ALL" || row.type === typeF) &&
        (!query ||
          row.emp.toLowerCase().includes(query) ||
          row.reference.toLowerCase().includes(query) ||
          row.matricule.toLowerCase().includes(query)),
    );
  }, [rows, department, statusF, typeF, search]);

  const planningLeaves = useMemo(
    () =>
      planningData.team.flatMap((member) =>
        member.requests.map((request) => ({
          id: request.id,
          reference: request.reference,
          employee: member.name,
          manager: session?.name ?? "Manager",
          departmentCode: member.dept,
          departmentName: member.departmentName,
          type: request.type,
          startDate: request.startDate,
          endDate: request.endDate,
          days: request.days,
          status: request.status,
        })),
      ),
    [planningData.team, session?.name],
  );
  const types = useMemo(
    () =>
      Array.from(
        new Set([...rows.map((row) => row.type), ...planningLeaves.map((row) => row.type)]),
      ),
    [rows, planningLeaves],
  );
  const departments = useMemo(() => {
    const source = requestsQuery.data?.manager.managedDepartments ?? [];
    if (source.length > 0) return source.map((item) => ({ code: item.code, name: item.name }));

    const rowValues = new Map<string, string>();
    rows.forEach((row) => {
      if (row.dept && row.departmentName) rowValues.set(row.dept, row.departmentName);
    });
    return Array.from(rowValues.entries()).map(([code, name]) => ({ code, name }));
  }, [requestsQuery.data?.manager.managedDepartments, rows]);

  const planningRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return planningLeaves
      .filter((row) => row.status === "DRAFT")
      .filter((row) => department === "ALL" || row.departmentCode === department)
      .filter((row) => typeF === "ALL" || row.type === typeF)
      .filter(
        (row) =>
          !query ||
          `${row.reference} ${row.employee} ${row.departmentName} ${row.type}`
            .toLowerCase()
            .includes(query),
      );
  }, [planningLeaves, department, typeF, search]);

  const historyRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => row.status !== "pending")
      .filter((row) => (department === "ALL" ? true : row.dept === department))
      .filter((row) => (processedFilter === "ALL" ? true : row.status === processedFilter))
      .filter(
        (row) =>
          !query ||
          `${row.reference} ${row.emp} ${row.matricule} ${row.type} ${row.debut} ${row.fin} ${row.departmentName} ${row.statusLabel}`
            .toLowerCase()
            .includes(query),
      );
  }, [rows, department, processedFilter, search]);
  const departmentLabel = useMemo(() => {
    const departments = requestsQuery.data?.manager.managedDepartments ?? [];
    if (departments.length === 0) return session?.department?.name ?? "votre équipe";
    return departments.map((department) => department.name).join(", ");
  }, [requestsQuery.data?.manager.managedDepartments, session?.department?.name]);

  const decisionMutation = useMutation({
    mutationFn: ({
      requestId,
      decision,
      comment,
    }: {
      requestId: string;
      decision: Decision;
      comment?: string;
    }) => {
      if (!session) throw new Error("Session manager introuvable");
      return apiFetch<ManagerRequest>(`/manager/requests/${requestId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          managerId: session.id,
          managerEmail: session.email,
          decision,
          comment,
        }),
      });
    },
    onSuccess: (updated, variables) => {
      setDetail((current) => (current?.id === updated.id ? updated : current));
      setDecisionDialog(null);
      setDecisionComment("");
      toast.success(`Demande ${updated.reference} ${decisionLabels[variables.decision]}`);
      void queryClient.invalidateQueries({ queryKey: ["manager-requests"] });
    },
    onError: (error) => {
      toast.error("Décision impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const decide = (requestId: string, decision: Decision, comment?: string) => {
    decisionMutation.mutate({ requestId, decision, comment });
  };

  const openDecisionDialog = (
    request: ManagerRequest,
    decision: Extract<Decision, "reject" | "review">,
  ) => {
    setDecisionDialog({ request, decision });
    setDecisionComment("");
  };

  return (
    <AppShell
      title="Demandes & Validations"
      subtitle={`Pilotage des validations et planifications du périmètre ${departmentLabel}`}
    >
      <div className="mb-3">
        <DateRangeFilter value={dateRange} onChange={setDateRange} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
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
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={typeF}
          onChange={(event) => setTypeF(event.target.value)}
        >
          <option value="ALL">Tous types</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={processedFilter}
          onChange={(event) => setProcessedFilter(event.target.value as ProcessedFilter)}
        >
          <option value="ALL">Historique: tous statuts</option>
          <option value="revision">Historique: en attente RH / en revue</option>
          <option value="valid">Historique: validées RH</option>
          <option value="rejected">Historique: refusées / annulées</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher référence, employé..."
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attente action N+1" value={requestsQuery.isLoading ? "..." : filtered.filter((row) => row.status === "pending").length} tone="orange" />
        <StatCard label="Planifications département" value={planningQuery.isLoading ? "..." : planningRows.length} tone="yellow" />
        <StatCard label="Historique traité" value={requestsQuery.isLoading ? "..." : historyRows.length} tone="blue" />
        <StatCard label="Total filtré" value={(filtered.filter((row) => row.status === "pending").length + planningRows.length + historyRows.length).toString()} tone="blue" />
      </div>

      {(requestsQuery.isError || planningQuery.isError) && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger une partie des données de Demandes & Validations.</span>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void requestsQuery.refetch();
                void planningQuery.refetch();
              }}
              disabled={requestsQuery.isFetching || planningQuery.isFetching}
            >
              <RefreshCw className={`size-4 ${(requestsQuery.isFetching || planningQuery.isFetching) ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList className="bg-muted">
          <TabsTrigger value="pending">En attente d'action N+1 ({filtered.filter((row) => row.status === "pending").length})</TabsTrigger>
          <TabsTrigger value="planning">Congés planifiés ({planningRows.length})</TabsTrigger>
          <TabsTrigger value="history">Historique traité ({historyRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          <Card className="mt-6">
            <CardHeader
              title="Demandes en attente d'action N+1"
              action={<Badge tone="pending">Niveau N+1</Badge>}
            />

        {requestsQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Chargement des demandes manager...
          </div>
        ) : requestsQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            Impossible de charger les demandes manager.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr className="text-left">
                  <th className="px-5 py-3">Référence</th>
                  <th className="px-5 py-3">Employé</th>
                  <th className="px-5 py-3">N+1</th>
                  <th className="px-5 py-3">Département</th>
                  <th className="px-5 py-3">Type de congé</th>
                  <th className="px-5 py-3">Période</th>
                  <th className="px-5 py-3">Jours</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.filter((row) => row.status === "pending").length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                      Aucune demande en attente d'action N+1 pour ces filtres.
                    </td>
                  </tr>
                )}
                {filtered.filter((row) => row.status === "pending").map((request) => {
                  const status = statusMap[request.status];
                  const canDecide = request.canDecide && request.status === "pending";
                  return (
                    <tr key={request.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{request.reference}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="size-7 rounded-full bg-gradient-to-br from-stat-blue-fg to-stat-purple-fg" />
                          <div>
                            <div className="font-medium">{request.emp}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {request.matricule} · {request.dept}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">{session?.name ?? "Manager"}</td>
                      <td className="px-5 py-3">{request.departmentName}</td>
                      <td className="px-5 py-3">{request.type}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {request.debut} → {request.fin}
                      </td>
                      <td className="px-5 py-3">{request.jours} j</td>
                      <td className="px-5 py-3">
                        <Badge tone={status.tone}>{request.statusLabel ?? status.label}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setDetail(request)}>
                            <Eye className="size-4" /> Détail
                          </Button>
                          {canDecide && (
                            <>
                              <Button
                                variant="success"
                                size="sm"
                                disabled={decisionMutation.isPending}
                                onClick={() => decide(request.id, "approve")}
                              >
                                <Check className="size-4" /> Valider
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={decisionMutation.isPending}
                                onClick={() => openDecisionDialog(request, "reject")}
                              >
                                <X className="size-4" /> Refuser
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </Card>
        </TabsContent>

        <TabsContent value="planning" className="mt-6">
          <Card className="mt-6">
            <CardHeader title="Tous les congés planifiés du département" />
            {planningQuery.isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                Chargement des planifications manager...
              </div>
            ) : planningQuery.isError ? (
              <div className="px-5 py-10 text-center text-sm text-destructive">
                Impossible de charger les planifications manager.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-5 py-3">Référence</th>
                      <th className="px-5 py-3">Employé</th>
                      <th className="px-5 py-3">N+1</th>
                      <th className="px-5 py-3">Département</th>
                      <th className="px-5 py-3">Type de congé</th>
                      <th className="px-5 py-3">Période</th>
                      <th className="px-5 py-3">Jours</th>
                      <th className="px-5 py-3">Statut</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {planningRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                          Aucune planification disponible.
                        </td>
                      </tr>
                    )}
                    {planningRows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{row.reference}</td>
                        <td className="px-5 py-3 font-medium">{row.employee}</td>
                        <td className="px-5 py-3">{row.manager}</td>
                        <td className="px-5 py-3">{row.departmentName}</td>
                        <td className="px-5 py-3">{row.type}</td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {formatDate(row.startDate)} - {formatDate(row.endDate)}
                        </td>
                        <td className="px-5 py-3">{formatNumber(row.days)}</td>
                        <td className="px-5 py-3">
                          <Badge tone={planningStatus(row.status).tone}>{planningStatus(row.status).label}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/manager/calendrier">Ouvrir</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <Card className="mt-6">
            <CardHeader title="Historique des demandes traitées" />
            {requestsQuery.isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                Chargement de l'historique manager...
              </div>
            ) : requestsQuery.isError ? (
              <div className="px-5 py-10 text-center text-sm text-destructive">
                Impossible de charger l'historique manager.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-5 py-3">Référence</th>
                      <th className="px-5 py-3">Employé</th>
                      <th className="px-5 py-3">Département</th>
                      <th className="px-5 py-3">Type de congé</th>
                      <th className="px-5 py-3">Période</th>
                      <th className="px-5 py-3">Jours</th>
                      <th className="px-5 py-3">Statut</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {historyRows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                          Aucun historique disponible.
                        </td>
                      </tr>
                    )}
                    {historyRows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{row.reference}</td>
                        <td className="px-5 py-3">{row.emp}</td>
                        <td className="px-5 py-3">{row.departmentName}</td>
                        <td className="px-5 py-3">{row.type}</td>
                        <td className="px-5 py-3 text-muted-foreground">{row.debut} → {row.fin}</td>
                        <td className="px-5 py-3">{row.jours}</td>
                        <td className="px-5 py-3">
                          <Badge tone={statusMap[row.status].tone}>{row.statusLabel}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to="/manager/historique">Ouvrir</Link>
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => exportHistoryRowCsv(row)}>
                              <Download className="size-4" /> Exporter
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Détail de la demande</DialogTitle>
            <DialogDescription>
              {detail?.reference} — {detail?.emp}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info k="Employé" v={`${detail.emp} (${detail.matricule})`} />
              <Info k="Département" v={detail.departmentName} />
              <Info k="Poste" v={detail.poste} />
              <Info k="Type" v={detail.type} />
              <Info k="Période" v={`${detail.debut} → ${detail.fin}`} />
              <Info k="Jours" v={`${detail.jours} jours ouvrables`} />
              <Info k="Solde" v={`${detail.solde} j`} />
              <Info k="Statut" v={detail.statusLabel} />
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Motif</div>
                <div className="font-medium">{detail.motif}</div>
              </div>
            </dl>
          )}
          <DialogFooter className="gap-2">
            {detail && detail.canDecide && detail.status === "pending" && (
              <>
                <Button
                  variant="success"
                  disabled={decisionMutation.isPending}
                  onClick={() => decide(detail.id, "approve")}
                >
                  <Check className="size-4" /> Valider
                </Button>
                <Button
                  variant="warning"
                  disabled={decisionMutation.isPending}
                  onClick={() => openDecisionDialog(detail, "review")}
                >
                  <RotateCcw className="size-4" /> Revue
                </Button>
                <Button
                  variant="danger"
                  disabled={decisionMutation.isPending}
                  onClick={() => openDecisionDialog(detail, "reject")}
                >
                  <X className="size-4" /> Refuser
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setDetail(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!decisionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDecisionDialog(null);
            setDecisionComment("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {decisionDialog?.decision === "reject"
                ? "Motif de refus obligatoire"
                : "Motif de revue obligatoire"}
            </DialogTitle>
            <DialogDescription>
              {decisionDialog
                ? `La demande ${decisionDialog.request.reference} nécessite un motif avant validation de cette action.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!decisionDialog) return;

              const comment = decisionComment.trim();
              if (!comment) return;

              decide(decisionDialog.request.id, decisionDialog.decision, comment);
            }}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Motif</span>
              <textarea
                value={decisionComment}
                onChange={(event) => setDecisionComment(event.target.value)}
                rows={4}
                maxLength={500}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                placeholder={
                  decisionDialog?.decision === "reject"
                    ? "Expliquez clairement la raison du refus..."
                    : "Expliquez ce qui doit être corrigé avant nouvelle soumission..."
                }
              />
              {!decisionComment.trim() && (
                <p className="text-xs text-destructive">
                  Le motif est obligatoire pour cette action.
                </p>
              )}
            </label>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDecisionDialog(null);
                  setDecisionComment("");
                }}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                variant={decisionDialog?.decision === "reject" ? "danger" : "warning"}
                disabled={decisionMutation.isPending || !decisionComment.trim()}
              >
                {decisionDialog?.decision === "reject" ? "Confirmer le refus" : "Demander la revue"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}
