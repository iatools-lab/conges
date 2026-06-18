import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarDays, FileCheck2, Pencil, Plus, RefreshCw, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

type BadgeTone = "valid" | "pending" | "rejected" | "draft" | "neutral";
type SpecialLeaveStatusCode =
  | "DRAFT"
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";
type EmployeeStatus = "active" | "leave" | "inactive";

type RhEmployee = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  dept: string;
  status: EmployeeStatus;
};

type SpecialLeaveRow = {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  matricule: string;
  department: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  eventLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  proof: boolean;
  proofLabel: string;
  status: BadgeTone;
  statusCode: SpecialLeaveStatusCode;
  statusLabel: string;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
  reason: string;
  rhComment?: string;
};

type SpecialLeavesResponse = {
  year: number;
  rows: SpecialLeaveRow[];
  totals: {
    total: number;
    approved: number;
    pending: number;
    days: number;
  };
};

type SpecialLeavePayload = {
  employeeId: string;
  eventLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: SpecialLeaveStatusCode;
  proofUrl: string;
};

const emptyRows: SpecialLeaveRow[] = [];
const emptyEmployees: RhEmployee[] = [];
const emptyTotals: SpecialLeavesResponse["totals"] = {
  total: 0,
  approved: 0,
  pending: 0,
  days: 0,
};

const eventOptions = [
  "Mariage",
  "Naissance",
  "Décès parent",
  "Accouchement épouse",
  "Maladie",
  "Autre",
];

const statusOptions: { value: SpecialLeaveStatusCode; label: string }[] = [
  { value: "PENDING", label: "À confirmer" },
  { value: "IN_REVIEW", label: "En revue" },
  { value: "APPROVED", label: "Validé" },
  { value: "REJECTED", label: "À revoir" },
  { value: "CANCELLED", label: "Annulé" },
];

const emptyDraft: SpecialLeavePayload = {
  employeeId: "",
  eventLabel: "Mariage",
  startDate: "",
  endDate: "",
  days: 1,
  reason: "",
  status: "APPROVED",
  proofUrl: "",
};

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function formatEmployeeLabel(employee: RhEmployee) {
  return `${employee.matricule} - ${employee.prenom} ${employee.nom}`;
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value}T00:00:00.000Z`));
}

function normalizePayload(payload: SpecialLeavePayload): SpecialLeavePayload {
  return {
    ...payload,
    eventLabel: payload.eventLabel.trim(),
    reason: payload.reason.trim(),
    proofUrl: payload.proofUrl.trim(),
    days: Number(payload.days),
  };
}

function SpecialLeaveForm({
  draft,
  employees,
  disabled,
  submitLabel,
  onCancel,
  onSubmit,
  setDraft,
}: {
  draft: SpecialLeavePayload;
  employees: RhEmployee[];
  disabled: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: () => void;
  setDraft: Dispatch<SetStateAction<SpecialLeavePayload>>;
}) {
  const set = <K extends keyof SpecialLeavePayload>(key: K, value: SpecialLeavePayload[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Employé *</span>
          <select
            className={inputClass}
            value={draft.employeeId}
            onChange={(event) => set("employeeId", event.target.value)}
            required
          >
            <option value="">Sélectionner un employé</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {formatEmployeeLabel(employee)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Événement *</span>
          <select
            className={inputClass}
            value={draft.eventLabel}
            onChange={(event) => set("eventLabel", event.target.value)}
            required
          >
            {eventOptions.map((eventOption) => (
              <option key={eventOption} value={eventOption}>
                {eventOption}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Statut *</span>
          <select
            className={inputClass}
            value={draft.status}
            onChange={(event) => set("status", event.target.value as SpecialLeaveStatusCode)}
            required
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Début *</span>
          <input
            type="date"
            className={inputClass}
            value={draft.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Fin *</span>
          <input
            type="date"
            className={inputClass}
            value={draft.endDate}
            onChange={(event) => set("endDate", event.target.value)}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Jours *</span>
          <input
            type="number"
            min="0.5"
            step="0.5"
            className={inputClass}
            value={draft.days}
            onChange={(event) => set("days", Number(event.target.value))}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Lien justificatif</span>
          <input
            className={inputClass}
            value={draft.proofUrl}
            onChange={(event) => set("proofUrl", event.target.value)}
            placeholder="https://..."
          />
        </label>

        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Motif / commentaire RH</span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={draft.reason}
            onChange={(event) => set("reason", event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-2 sm:flex sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" className="justify-center" onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" className="justify-center" disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function NewSpecialLeaveDialog({
  employees,
  disabled,
  onCreate,
}: {
  employees: RhEmployee[];
  disabled: boolean;
  onCreate: (payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SpecialLeavePayload>(emptyDraft);

  const submit = async () => {
    try {
      await onCreate(normalizePayload(draft));
      setOpen(false);
      setDraft(emptyDraft);
    } catch (error) {
      toast.error("Création impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setDraft(emptyDraft);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled || !employees.length}>
          <Plus className="size-4" /> Nouvelle demande
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Nouveau congé spécial</DialogTitle>
          <DialogDescription>
            Enregistrez la demande spéciale et son impact sur le quota annuel séparé.
          </DialogDescription>
        </DialogHeader>
        <SpecialLeaveForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel={disabled ? "Création..." : "Créer"}
          setDraft={setDraft}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditSpecialLeaveDialog({
  row,
  employees,
  disabled,
  onSave,
}: {
  row: SpecialLeaveRow;
  employees: RhEmployee[];
  disabled: boolean;
  onSave: (id: string, payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SpecialLeavePayload>({
    employeeId: row.employeeId,
    eventLabel: row.eventLabel,
    startDate: row.startDate,
    endDate: row.endDate,
    days: row.days,
    reason: row.reason,
    status: row.statusCode,
    proofUrl: "",
  });

  const resetDraft = () =>
    setDraft({
      employeeId: row.employeeId,
      eventLabel: row.eventLabel,
      startDate: row.startDate,
      endDate: row.endDate,
      days: row.days,
      reason: row.reason,
      status: row.statusCode,
      proofUrl: "",
    });

  const submit = async () => {
    try {
      await onSave(row.id, normalizePayload(draft));
      setOpen(false);
    } catch (error) {
      toast.error("Modification impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetDraft();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="px-3 py-1.5" disabled={disabled}>
          <Pencil className="size-4" /> Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Modifier {row.reference}</DialogTitle>
          <DialogDescription>
            Ajustez le statut, la période ou le justificatif de cette demande spéciale.
          </DialogDescription>
        </DialogHeader>
        <SpecialLeaveForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel="Enregistrer"
          setDraft={setDraft}
          onCancel={() => setOpen(false)}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

function SpecialLeaveCard({
  row,
  employees,
  disabled,
  onCancel,
  onApproveEvent,
  onRejectEvent,
  onSave,
}: {
  row: SpecialLeaveRow;
  employees: RhEmployee[];
  disabled: boolean;
  onCancel: (row: SpecialLeaveRow) => void;
  onApproveEvent: (row: SpecialLeaveRow) => void;
  onRejectEvent: (row: SpecialLeaveRow) => void;
  onSave: (id: string, payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const isEventRow = row.leaveTypeCode === "EVT";

  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{row.employeeName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.matricule} · {row.department}
          </div>
        </div>
        <Badge tone={row.status}>{row.statusLabel}</Badge>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Événement</div>
          <div className="mt-1 font-medium">{row.eventLabel}</div>
          <div className="text-xs text-muted-foreground">{row.reference}</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Période</div>
          <div className="mt-1 font-medium">
            {formatDate(row.startDate)} - {formatDate(row.endDate)}
          </div>
          <div className="text-xs text-muted-foreground">{row.days} jour(s)</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Justificatif</div>
          <div className="mt-1 font-medium">{row.proofLabel}</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Quota restant</div>
          <div className="mt-1 font-semibold">{row.quotaRemaining} jour(s)</div>
          <div className="text-xs text-muted-foreground">sur {row.quotaTotal} jour(s)</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {isEventRow ? (
          <>
            <Button
              variant="outline"
              className="px-3 py-1.5"
              disabled={disabled || row.statusCode === "APPROVED"}
              onClick={() => onApproveEvent(row)}
            >
              Valider
            </Button>
            <Button
              variant="outline"
              className="px-3 py-1.5 text-destructive"
              disabled={disabled || row.statusCode === "REJECTED"}
              onClick={() => onRejectEvent(row)}
            >
              Refuser
            </Button>
          </>
        ) : (
          <>
            <EditSpecialLeaveDialog
              row={row}
              employees={employees}
              disabled={disabled}
              onSave={onSave}
            />
            <Button
              variant="outline"
              className="px-3 py-1.5 text-muted-foreground"
              disabled={disabled || row.statusCode === "CANCELLED"}
              onClick={() => onCancel(row)}
            >
              <XCircle className="size-4" /> Annuler
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export function Speciaux() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | SpecialLeaveStatusCode>("");
  const [cancelTarget, setCancelTarget] = useState<SpecialLeaveRow | null>(null);

  const specialLeavesQuery = useQuery({
    queryKey: ["rh-special-leaves", year],
    queryFn: () => apiFetch<SpecialLeavesResponse>(`/rh/special-leaves?year=${year}`),
  });

  const employeesQuery = useQuery({
    queryKey: ["rh-employees"],
    queryFn: () => apiFetch<RhEmployee[]>("/rh/employees"),
  });

  const rows = specialLeavesQuery.data?.rows ?? emptyRows;
  const totals = specialLeavesQuery.data?.totals ?? emptyTotals;
  const employees = useMemo(
    () =>
      (employeesQuery.data ?? emptyEmployees).filter((employee) => employee.status !== "inactive"),
    [employeesQuery.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-special-leaves"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const createSpecialLeave = useMutation({
    mutationFn: (payload: SpecialLeavePayload) =>
      apiFetch<SpecialLeaveRow>("/rh/special-leaves", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Congé spécial créé");
      refresh();
    },
  });

  const updateSpecialLeave = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SpecialLeavePayload }) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Congé spécial mis à jour");
      refresh();
    },
  });

  const decideEvent = useMutation({
    mutationFn: ({ id, status }: { id: string; status: SpecialLeaveStatusCode }) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast.success("Événement mis à jour");
      refresh();
    },
  });

  const cancelSpecialLeave = useMutation({
    mutationFn: (id: string) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Congé spécial annulé");
      refresh();
    },
    onError: (error) => {
      toast.error("Annulation impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !query ||
        row.employeeName.toLowerCase().includes(query) ||
        row.matricule.toLowerCase().includes(query) ||
        row.department.toLowerCase().includes(query) ||
        row.eventLabel.toLowerCase().includes(query) ||
        row.reference.toLowerCase().includes(query);
      const matchesStatus = !statusFilter || row.statusCode === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);
  const eventRows = useMemo(
    () => filteredRows.filter((row) => row.leaveTypeCode === "EVT"),
    [filteredRows],
  );
  const specialRows = useMemo(
    () => filteredRows.filter((row) => row.leaveTypeCode !== "EVT"),
    [filteredRows],
  );

  const isMutating =
    createSpecialLeave.isPending ||
    updateSpecialLeave.isPending ||
    cancelSpecialLeave.isPending ||
    decideEvent.isPending;

  const cancelRow = (row: SpecialLeaveRow) => {
    setCancelTarget(row);
  };

  const confirmCancel = () => {
    if (!cancelTarget) return;
    cancelSpecialLeave.mutate(cancelTarget.id, {
      onSettled: () => setCancelTarget(null),
    });
  };

  const approveEvent = (row: SpecialLeaveRow) => {
    decideEvent.mutate({ id: row.id, status: "APPROVED" });
  };

  const rejectEvent = (row: SpecialLeaveRow) => {
    decideEvent.mutate({ id: row.id, status: "REJECTED" });
  };

  return (
    <AppShell title="Congés spéciaux (RH)">
      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <AlertDialogTrigger asChild>
          <span className="hidden" aria-hidden="true" />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation requise</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `Vous allez annuler ${cancelTarget.reference} de ${cancelTarget.employeeName}. Cette action est irreversible.`
                : "Vous allez annuler ce congé spécial."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Retour</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isMutating}
              onClick={confirmCancel}
            >
              Confirmer l'annulation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Demandes spéciales" value={totals.total} tone="blue" />
        <StatCard label="Validées" value={totals.approved} tone="green" />
        <StatCard label="Jours utilisés" value={totals.days} suffix="jour(s)" tone="orange" />
        <StatCard label="À traiter" value={totals.pending} tone="yellow" />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="font-semibold">Registre des congés spéciaux</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Quota annuel séparé, justificatifs et validations RH.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] xl:flex xl:items-center">
            <div className="relative min-w-0 xl:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
                placeholder="Employé, événement, référence..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "" | SpecialLeaveStatusCode)
              }
            >
              <option value="">Tous statuts</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border bg-background px-3 py-2 text-sm"
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
            <Button variant="outline" onClick={refresh} disabled={specialLeavesQuery.isFetching}>
              <RefreshCw className="size-4" /> Actualiser
            </Button>
          </div>
        </div>

        {specialLeavesQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Chargement des congés spéciaux...
          </div>
        ) : specialLeavesQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            Impossible de charger les congés spéciaux.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aucun congé spécial trouvé.
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-4 xl:hidden">
              {filteredRows.map((row) => (
                <SpecialLeaveCard
                  key={row.id}
                  row={row}
                  employees={employees}
                  disabled={isMutating}
                  onCancel={cancelRow}
                  onApproveEvent={approveEvent}
                  onRejectEvent={rejectEvent}
                  onSave={(id, payload) => updateSpecialLeave.mutateAsync({ id, payload })}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Type événement</th>
                    <th className="px-5 py-3">Date événement</th>
                    <th className="px-5 py-3">Justificatif</th>
                    <th className="px-5 py-3">Commentaire employé</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3">Commentaire RH</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {eventRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-5 py-3">
                        <div className="font-medium">{row.employeeName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.matricule} · {row.department}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium">{row.eventLabel}</div>
                        <div className="text-xs text-muted-foreground">{row.reference}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="inline-flex items-center gap-2">
                          <CalendarDays className="size-4 text-muted-foreground" />
                          {formatDate(row.startDate)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-2">
                          <FileCheck2 className="size-4 text-muted-foreground" /> {row.proofLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3">{row.reason || "-"}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.statusLabel}</Badge>
                      </td>
                      <td className="px-5 py-3">{row.rhComment || "-"}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            className="px-3 py-1.5"
                            disabled={isMutating || row.statusCode === "APPROVED"}
                            onClick={() => approveEvent(row)}
                          >
                            Valider
                          </Button>
                          <Button
                            variant="outline"
                            className="px-3 py-1.5 text-destructive"
                            disabled={isMutating || row.statusCode === "REJECTED"}
                            onClick={() => rejectEvent(row)}
                          >
                            Refuser
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {eventRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                        Aucun événement déclaré.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {specialRows.length > 0 && (
              <div className="hidden overflow-x-auto border-t xl:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3">Employé</th>
                      <th className="px-5 py-3">Événement</th>
                      <th className="px-5 py-3">Période</th>
                      <th className="px-5 py-3">Jours</th>
                      <th className="px-5 py-3">Statut</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {specialRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-5 py-3">{row.employeeName}</td>
                        <td className="px-5 py-3">{row.eventLabel}</td>
                        <td className="px-5 py-3">
                          {formatDate(row.startDate)} - {formatDate(row.endDate)}
                        </td>
                        <td className="px-5 py-3">{row.days}</td>
                        <td className="px-5 py-3">
                          <Badge tone={row.status}>{row.statusLabel}</Badge>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <EditSpecialLeaveDialog
                              row={row}
                              employees={employees}
                              disabled={isMutating}
                              onSave={(id, payload) =>
                                updateSpecialLeave.mutateAsync({ id, payload })
                              }
                            />
                            <Button
                              variant="outline"
                              className="px-3 py-1.5 text-muted-foreground"
                              disabled={isMutating || row.statusCode === "CANCELLED"}
                              onClick={() => cancelRow(row)}
                            >
                              <XCircle className="size-4" /> Annuler
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </AppShell>
  );
}
