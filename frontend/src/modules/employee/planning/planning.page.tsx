import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  dateRangeYear,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import {
  LeaveTypeOption,
  NewRequestForm,
  type NewRequestPayload,
} from "@/components/NewRequestForm";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, Button, Card, CardHeader } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Pencil,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Status = "draft" | "pending" | "valid" | "rejected" | "neutral" | "planned" | "review";
type Plan = {
  id: string;
  reference: string;
  debut: string;
  fin: string;
  startDate: string;
  endDate: string;
  jours: number;
  type: string;
  leaveTypeCode?: string;
  leaveSubtypeCode?: string;
  typeLabel: string;
  category: string;
  statusCode: string;
  status: Status;
  label: string;
  remplacant: string;
  reason: string;
  canSubmit: boolean;
  canCancel: boolean;
  canDelete: boolean;
};

type EmployeePlanningResponse = {
  year: number;
  user: {
    name: string;
    matricule: string;
    department: { name: string; manager: string | null } | null;
  };
  leaveTypes: LeaveTypeOption[];
  stats: {
    totalPlanifie: number;
    draft: number;
    pending: number;
    valid: number;
    rejected: number;
  };
  plans: Plan[];
};

type LeaveRequestRow = {
  id: string;
  reference: string;
  date: string;
  type: string;
  leaveTypeCode?: string;
  leaveSubtypeCode?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
  periode: string;
  jours: number;
  status: Status;
  stext: string;
  last: string;
  reviewComment?: string;
  canEdit?: boolean;
  canCancel?: boolean;
};

type EmployeeLeaveRequestsResponse = {
  leaveTypes: LeaveTypeOption[];
  rows: LeaveRequestRow[];
};

const emptyPlans: Plan[] = [];
const emptyRequestRows: LeaveRequestRow[] = [];
const emptyLeaveTypes: LeaveTypeOption[] = [];

const STATUS_BG: Record<Status, string> = {
  draft: "bg-status-draft text-status-draft-fg",
  pending: "bg-status-pending text-status-pending-fg",
  valid: "bg-stat-green text-stat-green-fg",
  rejected: "bg-status-rejected text-status-rejected-fg",
  neutral: "bg-muted text-muted-foreground",
  planned: "bg-stat-yellow text-stat-yellow-fg",
  review: "bg-stat-orange text-stat-orange-fg",
};

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

function buildPlanningPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
  });
  appendDateRange(params, range);

  return `/employee/planning?${params.toString()}`;
}

function buildRequestsPath(session: { id: string; email: string }, range: DateRangeValue) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
  });
  appendDateRange(params, range);

  return `/employee/leave-requests?${params.toString()}`;
}

function requestOwner(session: { id: string; email: string }) {
  return { userId: session.id, userEmail: session.email };
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

function planCoversDay(plan: Plan, year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return toDate(plan.startDate) <= date && date <= toDate(plan.endDate);
}

function planYear(plan: Plan) {
  return toDate(plan.startDate).getUTCFullYear();
}

function MonthMini({ year, month, plans }: { year: number; month: number; plans: Plan[] }) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, index) => index + 1),
  ];

  return (
    <div className="border rounded-lg p-3">
      <div className="text-sm font-medium mb-2">{MONTHS_FR[month]}</div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground mb-1">
        {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => (
          <div key={`${day}-${index}`}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <div key={index} />;
          const plan = plans.find((item) => planCoversDay(item, year, month, day));
          return (
            <div
              key={index}
              className={`aspect-square flex items-center justify-center rounded text-[10px] ${
                plan ? `${STATUS_BG[plan.status]} font-semibold` : "text-foreground/70"
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

function MonthLarge({ year, month, plans }: { year: number; month: number; plans: Plan[] }) {
  const total = daysInMonth(year, month);
  const offset = firstWeekday(year, month);
  const visibleCells = Math.ceil((offset + total) / 7) * 7;

  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
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
              className={`min-h-20 rounded border p-2 text-sm flex flex-col ${
                !inMonth ? "bg-muted/30 text-muted-foreground/40" : "hover:bg-accent"
              }`}
            >
              <span className="text-xs">{inMonth ? day : ""}</span>
              {dayPlans.slice(0, 2).map((plan) => (
                <span
                  key={plan.id}
                  className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BG[plan.status]}`}
                >
                  {plan.type}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Planifier() {
  const { session } = useAuthSession();
  const queryClient = useQueryClient();
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange(today));
  const year = dateRangeYear(dateRange, today.getFullYear());
  const [detail, setDetail] = useState<Plan | null>(null);
  const [q, setQ] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [requestType, setRequestType] = useState("all");
  const [requestStatus, setRequestStatus] = useState("all");
  const [editingRequest, setEditingRequest] = useState<LeaveRequestRow | null>(null);
  const [editLeaveTypeCode, setEditLeaveTypeCode] = useState("");
  const [editLeaveSubtypeCode, setEditLeaveSubtypeCode] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editReason, setEditReason] = useState("");
  const [fType, setFType] = useState("all");
  const [fYear, setFYear] = useState("all");
  const queryKey = ["employee-planning", session?.id, session?.email, ...dateRangeQueryKey(dateRange)];
  const requestQueryKey = [
    "employee-leave-requests",
    session?.id,
    session?.email,
    ...dateRangeQueryKey(dateRange),
  ];

  const planningQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<EmployeePlanningResponse>(buildPlanningPath(session!, dateRange)),
    enabled: !!session,
  });

  const requestsQuery = useQuery({
    queryKey: requestQueryKey,
    queryFn: () => apiFetch<EmployeeLeaveRequestsResponse>(buildRequestsPath(session!, dateRange)),
    enabled: !!session,
  });

  const plans = planningQuery.data?.plans ?? emptyPlans;
  const requestRows = requestsQuery.data?.rows ?? emptyRequestRows;
  const leaveTypes = planningQuery.data?.leaveTypes ?? requestsQuery.data?.leaveTypes ?? emptyLeaveTypes;
  const user = planningQuery.data?.user;
  const stats = planningQuery.data?.stats;
  const selectedEditLeaveType = useMemo(
    () => leaveTypes.find((type) => type.code === editLeaveTypeCode),
    [editLeaveTypeCode, leaveTypes],
  );
  const editSubtypeOptions = selectedEditLeaveType?.children ?? [];

  const createDirectRequest = useMutation({
    mutationFn: (payload: NewRequestPayload) =>
      apiFetch<LeaveRequestRow>("/employee/leave-requests", {
        method: "POST",
        body: JSON.stringify({ ...requestOwner(session!), ...payload, draft: false }),
      }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: requestQueryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard-requests"] });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      toast.success(`Demande ${row.reference} envoyée`);
    },
    onError: (error) => toast.error(error.message),
  });

  const createRequest = useMutation({
    mutationFn: (payload: NewRequestPayload) =>
      apiFetch<Plan>("/employee/leave-requests", {
        method: "POST",
        body: JSON.stringify({ ...requestOwner(session!), ...payload, draft: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["employee-history"] });
      toast.success("Planification enregistrée");
    },
    onError: (error) => toast.error(error.message),
  });

  const submitPlan = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Plan>(`/employee/leave-requests/${id}/submit`, {
        method: "POST",
        body: JSON.stringify(requestOwner(session!)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Planification soumise");
    },
    onError: (error) => toast.error(error.message),
  });

  const updateRequest = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: NewRequestPayload }) =>
      apiFetch<LeaveRequestRow>(`/employee/leave-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...requestOwner(session!), ...payload }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestQueryKey });
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard-requests"] });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Demande mise à jour et renvoyée");
      setEditingRequest(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const cancelRequest = useMutation({
    mutationFn: (id: string) =>
      apiFetch<LeaveRequestRow>(`/employee/leave-requests/${id}`, {
        method: "DELETE",
        body: JSON.stringify(requestOwner(session!)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestQueryKey });
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-dashboard-requests"] });
      toast.success("Demande annulée");
    },
    onError: (error) => toast.error(error.message),
  });

  const cancelPlan = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Plan>(`/employee/leave-requests/${id}`, {
        method: "DELETE",
        body: JSON.stringify(requestOwner(session!)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-leave-requests"] });
      toast.success("Planification annulée");
    },
    onError: (error) => toast.error(error.message),
  });

  const deletePlan = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; deleted: boolean }>(`/employee/leave-requests/${id}/permanent`, {
        method: "DELETE",
        body: JSON.stringify(requestOwner(session!)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["employee-leave-requests"] });
      toast.success("Planification supprimée");
    },
    onError: (error) => toast.error(error.message),
  });

  const requestTypeOptions = useMemo(
    () => Array.from(new Set(requestRows.map((row) => row.type))).sort((a, b) => a.localeCompare(b)),
    [requestRows],
  );

  const filteredRequests = useMemo(() => {
    return requestRows
      .filter((row) => row.status !== "planned")
      .filter((row) => requestType === "all" || row.type === requestType)
      .filter((row) => requestStatus === "all" || row.status === requestStatus)
      .filter((row) => {
        const value = requestSearch.trim().toLowerCase();
        if (!value) return true;

        return (
          row.reference.toLowerCase().includes(value) ||
          row.type.toLowerCase().includes(value) ||
          row.periode.toLowerCase().includes(value) ||
          row.last.toLowerCase().includes(value) ||
          (row.reviewComment ?? "").toLowerCase().includes(value)
        );
      });
  }, [requestRows, requestSearch, requestStatus, requestType]);

  const plannedRows = useMemo(
    () => plans.filter((plan) => plan.status === "planned"),
    [plans],
  );

  const filteredPlans = useMemo(() => {
    return plannedRows.filter((plan) => {
      if (fType !== "all" && plan.type !== fType) return false;
      if (fYear !== "all" && String(planYear(plan)) !== fYear) return false;
      if (q.trim()) {
        const value = q.toLowerCase();
        if (
          !plan.reference.toLowerCase().includes(value) &&
          !plan.typeLabel.toLowerCase().includes(value) &&
          !plan.debut.includes(value) &&
          !plan.fin.includes(value)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [fType, fYear, plannedRows, q]);

  const yearsAvailable = Array.from(new Set([year, ...plannedRows.map(planYear)])).sort((a, b) => b - a);
  const hasPlanFilters = q || fType !== "all" || fYear !== "all";
  const hasRequestFilters = requestSearch || requestType !== "all" || requestStatus !== "all";

  const resetRequestFilters = () => {
    setRequestSearch("");
    setRequestType("all");
    setRequestStatus("all");
  };

  const resetFilters = () => {
    setQ("");
    setFType("all");
    setFYear("all");
  };

  const openEditRequest = (row: LeaveRequestRow) => {
    setEditingRequest(row);
    const nextLeaveTypeCode = row.leaveTypeCode ?? leaveTypes[0]?.code ?? "";
    const nextLeaveType = leaveTypes.find((type) => type.code === nextLeaveTypeCode);
    setEditLeaveTypeCode(nextLeaveTypeCode);
    setEditLeaveSubtypeCode(row.leaveSubtypeCode ?? nextLeaveType?.children?.[0]?.code ?? "");
    setEditStartDate(row.startDate ?? "");
    setEditEndDate(row.endDate ?? "");
    setEditReason(row.reason ?? "");
  };

  return (
    <AppShell
      title="Demandes et planification"
      subtitle={
        user ? `${user.name} · Matricule ${user.matricule}` : "Demandes et planning personnel"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="inline-flex flex-wrap items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
          <Building2 className="size-4" />
          Département :
          <span className="font-medium text-foreground">
            {user?.department?.name ?? "Non affecté"}
          </span>
          <span className="opacity-50">·</span>
          Manager :
          <span className="font-medium text-foreground">
            {user?.department?.manager ?? "Non affecté"}
          </span>
        </div>
      </div>

      <DateRangeFilter value={dateRange} onChange={setDateRange} className="mb-4" />

      {planningQuery.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Impossible de charger la planification. {planningQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      {requestsQuery.isError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Impossible de charger vos demandes. {requestsQuery.error.message}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="demandes" className="w-full">
        <TabsList className="bg-muted">
          <TabsTrigger value="demandes">Demande de congés</TabsTrigger>
          <TabsTrigger value="planifier">Planifier un congé</TabsTrigger>
        </TabsList>

        <TabsContent value="demandes" className="mt-4">
          <Card>
            <CardHeader
              title={`Mes demandes (${filteredRequests.length})`}
              action={
                session && (
                  <NewRequestForm
                    session={session}
                    leaveTypes={leaveTypes}
                    submitting={createDirectRequest.isPending}
                    onSubmit={(payload) => createDirectRequest.mutate(payload)}
                  />
                )
              }
            />

            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b bg-muted/30">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={requestSearch}
                  onChange={(event) => setRequestSearch(event.target.value)}
                  placeholder="Référence, type, période..."
                  className="w-full rounded-md border bg-background pl-8 pr-3 py-2 text-sm"
                />
              </div>
              <select
                value={requestType}
                onChange={(event) => setRequestType(event.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">Tous les types</option>
                {requestTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <select
                value={requestStatus}
                onChange={(event) => setRequestStatus(event.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">Tous les statuts</option>
                <option value="pending">En attente</option>
                <option value="review">En revue</option>
                <option value="valid">Confirmé</option>
                <option value="rejected">Refusé</option>
                <option value="neutral">Annulé</option>
              </select>
              {hasRequestFilters && (
                <button
                  onClick={resetRequestFilters}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
                >
                  <X className="size-3" /> Réinitialiser
                </button>
              )}
            </div>

            <LeaveRequestsSummaryTable
              rows={filteredRequests}
              loading={requestsQuery.isLoading}
              emptyMessage="Aucune demande enregistrée pour l'année sélectionnée."
              onEdit={openEditRequest}
              onCancel={(id) => {
                if (window.confirm("Annuler cette demande ?")) {
                  cancelRequest.mutate(id);
                }
              }}
            />
          </Card>
        </TabsContent>

        <TabsContent value="planifier" className="mt-4">
          <Card>
            <CardHeader
              title={`Mes planifications (${filteredPlans.length})`}
              action={
                session && (
                  <NewRequestForm
                    session={session}
                    leaveTypes={leaveTypes}
                    submitting={createRequest.isPending}
                    mode="planning"
                    onSubmit={(payload) => createRequest.mutate(payload)}
                  />
                )
              }
            />

            <div className="px-5 pt-4 text-sm text-muted-foreground">
              Cette vue regroupe uniquement les congés planifiés (brouillons non soumis).
            </div>

            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b bg-muted/30">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Référence, type, date…"
                  className="w-full rounded-md border bg-background pl-8 pr-3 py-2 text-sm"
                />
              </div>
              <select
                value={fType}
                onChange={(event) => setFType(event.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">Tous les types</option>
                {leaveTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.name}
                  </option>
                ))}
              </select>
              <select
                value={fYear}
                onChange={(event) => setFYear(event.target.value)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">Toutes les années</option>
                {yearsAvailable.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
                  {hasPlanFilters && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
                >
                  <X className="size-3" /> Réinitialiser
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Début</th>
                    <th className="px-5 py-3">Fin</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Remplaçant</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {planningQuery.isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                        Chargement des planifications...
                      </td>
                    </tr>
                  ) : filteredPlans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                        Aucune planification ne correspond aux filtres.
                      </td>
                    </tr>
                  ) : (
                    filteredPlans.map((plan) => (
                      <tr key={plan.id} className="hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium">{plan.reference}</td>
                        <td className="px-5 py-3">{plan.debut}</td>
                        <td className="px-5 py-3">{plan.fin}</td>
                        <td className="px-5 py-3">{plan.jours}</td>
                        <td className="px-5 py-3">{plan.typeLabel}</td>
                        <td className="px-5 py-3">{plan.remplacant}</td>
                        <td className="px-5 py-3">
                          <Badge tone={plan.status}>{plan.label}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <RowActions
                            label={`la planification ${plan.reference}`}
                            actions={[
                              {
                                label: "Voir détails",
                                icon: Eye,
                                onSelect: () => setDetail(plan),
                              },
                              ...(plan.canSubmit
                                ? [
                                    {
                                      label: "Soumettre",
                                      icon: Send,
                                      onSelect: () => submitPlan.mutate(plan.id),
                                    },
                                  ]
                                : []),
                              ...(plan.canCancel
                                ? [
                                    {
                                      label: "Annuler",
                                      icon: X,
                                      destructive: true,
                                      onSelect: () => cancelPlan.mutate(plan.id),
                                    },
                                  ]
                                : []),
                              ...(plan.canDelete
                                ? [
                                    {
                                      label: "Supprimer",
                                      icon: Trash2,
                                      destructive: true,
                                      onSelect: () => {
                                        if (window.confirm(`Supprimer ${plan.reference} ?`)) {
                                          deletePlan.mutate(plan.id);
                                        }
                                      },
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Détail · {detail?.reference}</DialogTitle>
            <DialogDescription>Informations de la planification.</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <Info label="Type" value={detail.typeLabel} />
              <Info label="Début" value={detail.debut} />
              <Info label="Fin" value={detail.fin} />
              <Info label="Jours" value={String(detail.jours)} />
              <Info label="Statut" value={detail.label} />
              <Info label="Remplaçant" value={detail.remplacant} />
              <Info label="Commentaire" value={detail.reason || "—"} className="col-span-3" />
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingRequest} onOpenChange={(open) => !open && setEditingRequest(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Modifier et renvoyer la demande</DialogTitle>
            <DialogDescription>
              Ajustez les informations, puis renvoyez la demande au manager.
            </DialogDescription>
          </DialogHeader>
          {editingRequest?.reviewComment && (
            <Alert>
              <AlertCircle className="size-4" />
              <AlertDescription>{editingRequest.reviewComment}</AlertDescription>
            </Alert>
          )}
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editingRequest) return;
              updateRequest.mutate({
                id: editingRequest.id,
                payload: {
                  leaveTypeCode: editLeaveTypeCode,
                  leaveSubtypeCode: editLeaveSubtypeCode || undefined,
                  startDate: editStartDate,
                  endDate: editEndDate,
                  reason: editReason.trim() || undefined,
                },
              });
            }}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Type de congé</span>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={editLeaveTypeCode}
                onChange={(event) => {
                  const nextCode = event.target.value;
                  const nextType = leaveTypes.find((type) => type.code === nextCode);
                  setEditLeaveTypeCode(nextCode);
                  setEditLeaveSubtypeCode(nextType?.children?.[0]?.code ?? "");
                }}
                required
              >
                {leaveTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.name}
                  </option>
                ))}
              </select>
            </label>

            {editSubtypeOptions.length > 0 && (
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  PrÃ©cision du congÃ©
                </span>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={editLeaveSubtypeCode}
                  onChange={(event) => setEditLeaveSubtypeCode(event.target.value)}
                  required
                >
                  {editSubtypeOptions.map((type) => (
                    <option key={type.code} value={type.code}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Date de début</span>
                <input
                  type="date"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={editStartDate}
                  onChange={(event) => setEditStartDate(event.target.value)}
                  required
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted-foreground">Date de fin</span>
                <input
                  type="date"
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={editEndDate}
                  onChange={(event) => setEditEndDate(event.target.value)}
                  required
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Commentaire</span>
              <textarea
                rows={4}
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                value={editReason}
                onChange={(event) => setEditReason(event.target.value)}
                placeholder="Expliquez les ajustements apportés..."
              />
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingRequest(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={updateRequest.isPending}>
                {updateRequest.isPending ? "Envoi..." : "Renvoyer la demande"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Info({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function LeaveRequestsSummaryTable({
  rows,
  loading,
  emptyMessage,
  onEdit,
  onCancel,
}: {
  rows: LeaveRequestRow[];
  loading: boolean;
  emptyMessage: string;
  onEdit: (row: LeaveRequestRow) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-3">Référence</th>
            <th className="px-5 py-3">Date</th>
            <th className="px-5 py-3">Type</th>
            <th className="px-5 py-3">Période</th>
            <th className="px-5 py-3">Jours</th>
            <th className="px-5 py-3">Statut</th>
            <th className="px-5 py-3">Dernière action</th>
            <th className="px-5 py-3">Commentaire revue</th>
            <th className="px-5 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading ? (
            <tr>
              <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                Chargement des demandes...
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30">
                <td className="px-5 py-3 font-medium">{row.reference}</td>
                <td className="px-5 py-3">{row.date}</td>
                <td className="px-5 py-3">{row.type}</td>
                <td className="px-5 py-3">{row.periode}</td>
                <td className="px-5 py-3">{row.jours}</td>
                <td className="px-5 py-3">
                  <Badge tone={row.status}>{row.stext}</Badge>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{row.last}</td>
                <td className="px-5 py-3 text-muted-foreground">
                  {row.reviewComment || "—"}
                </td>
                <td className="px-5 py-3 text-right">
                  {(row.canEdit || row.canCancel) && (
                    <div className="flex justify-end gap-2">
                      {row.canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onEdit(row)}
                        >
                          <Pencil className="size-4" /> Modifier
                        </Button>
                      )}
                      {row.canCancel && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onCancel(row.id)}
                        >
                          <X className="size-4" /> Annuler
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
