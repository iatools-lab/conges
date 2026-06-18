import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import {
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type LeaveCategory =
  | "CONGE_PAYE"
  | "CONGE_SPECIAL"
  | "CONGE_MATERNITE"
  | "CONGE_PATERNITE"
  | "CONGE_MALADIE"
  | "CONGE_SANS_SOLDE"
  | "RECUPERATION"
  | "TELETRAVAIL";

type RhLeaveType = {
  id: string;
  code: string;
  name: string;
  category: LeaveCategory;
  defaultDays: number;
  requiresProof: boolean;
  paid: boolean;
  color: string | null;
  active: boolean;
  description: string | null;
};

type BalanceSummary = {
  year: number;
  employees: number;
  leaveTypes: number;
  expectedBalances: number;
  existingBalances: number;
  missingBalances: number;
};

type RhSettingsResponse = {
  year: number;
  leaveTypes: RhLeaveType[];
  balanceSummary: BalanceSummary;
};

type LeaveTypePayload = Omit<RhLeaveType, "id" | "description" | "color"> & {
  color?: string;
  description?: string;
};

type DeleteLeaveTypeResponse = {
  mode: "deleted" | "archived";
  leaveType: RhLeaveType;
  references: {
    balances: number;
    requests: number;
  };
};

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear, currentYear + 1, currentYear - 1];

const categoryOptions: { value: LeaveCategory; label: string }[] = [
  { value: "CONGE_PAYE", label: "Congé payé" },
  { value: "CONGE_SPECIAL", label: "Congé spécial" },
  { value: "CONGE_MATERNITE", label: "Maternité" },
  { value: "CONGE_PATERNITE", label: "Paternité" },
  { value: "CONGE_MALADIE", label: "Maladie" },
  { value: "CONGE_SANS_SOLDE", label: "Sans solde" },
  { value: "TELETRAVAIL", label: "Télétravail" },
];

const categoryLabel = Object.fromEntries(
  categoryOptions.map((category) => [category.value, category.label]),
) as Record<LeaveCategory, string>;

const emptyLeaveType: LeaveTypePayload = {
  code: "",
  name: "",
  category: "CONGE_PAYE",
  defaultDays: 0,
  requiresProof: false,
  paid: true,
  active: true,
  color: "#2563EB",
  description: "",
};

const tableFieldClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

const compactCheckboxClass = "size-3.5 rounded border-input accent-navy";

function settingsPath(year: string) {
  return `/rh/settings?year=${encodeURIComponent(year)}`;
}

function toPayload(leaveType: LeaveTypePayload) {
  return {
    ...leaveType,
    code: leaveType.code.trim().toUpperCase(),
    name: leaveType.name.trim(),
    defaultDays: Number(leaveType.defaultDays),
    color: leaveType.color?.trim() || undefined,
    description: leaveType.description?.trim() || undefined,
  };
}

function leaveTypeToDraft(leaveType: RhLeaveType): LeaveTypePayload {
  return {
    code: leaveType.code,
    name: leaveType.name,
    category: leaveType.category,
    defaultDays: leaveType.defaultDays,
    requiresProof: leaveType.requiresProof,
    paid: leaveType.paid,
    active: leaveType.active,
    color: leaveType.color ?? "#2563EB",
    description: leaveType.description ?? "",
  };
}

function LeaveTypeActionsMenu({
  leaveType,
  disabled,
  onEdit,
  onDelete,
}: {
  leaveType: RhLeaveType;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="ml-auto h-9 justify-center rounded-md border border-border/60 bg-background px-3 text-xs text-foreground shadow-sm hover:bg-accent"
          disabled={disabled}
          aria-label={`Actions pour ${leaveType.code}`}
          title="Gérer"
        >
          <MoreHorizontal className="size-4 text-foreground" /> Gérer
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="mr-2 size-4" /> Modifier
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
          <Trash2 className="mr-2 size-4" /> Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LeaveTypeEditor({
  draft,
  setDraft,
  isSaving,
  isDeleting,
  onCancel,
  onSave,
  className = "",
  variant = "panel",
}: {
  draft: LeaveTypePayload;
  setDraft: Dispatch<SetStateAction<LeaveTypePayload>>;
  isSaving: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onSave: () => void;
  className?: string;
  variant?: "panel" | "plain";
}) {
  const surfaceClass =
    variant === "panel" ? `rounded-lg border bg-card p-3 shadow-sm sm:p-4 ${className}` : className;

  return (
    <div className={surfaceClass}>
      <div className="grid gap-3 xl:grid-cols-[120px_minmax(240px,1fr)_220px_110px_90px]">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Code
          <input
            className={`${tableFieldClass} min-w-0 font-semibold uppercase`}
            value={draft.code}
            onChange={(event) => setDraft((value) => ({ ...value, code: event.target.value }))}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Nom
          <input
            className={`${tableFieldClass} min-w-0 font-medium`}
            value={draft.name}
            onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Catégorie
          <select
            className={`${tableFieldClass} min-w-0`}
            value={draft.category}
            onChange={(event) =>
              setDraft((value) => ({ ...value, category: event.target.value as LeaveCategory }))
            }
          >
            {categoryOptions.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Quota
          <input
            className={`${tableFieldClass} min-w-0 text-right tabular-nums`}
            type="number"
            min="0"
            step="0.5"
            value={draft.defaultDays}
            onChange={(event) =>
              setDraft((value) => ({ ...value, defaultDays: Number(event.target.value) }))
            }
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Couleur
          <input
            className="h-10 w-full min-w-0 rounded-md border bg-background p-1"
            type="color"
            value={draft.color ?? "#2563EB"}
            onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))}
          />
        </label>
      </div>

      <label className="mt-3 grid gap-1.5 text-xs font-medium text-muted-foreground">
        Description
        <input
          className={`${tableFieldClass} min-w-0`}
          placeholder="Description"
          value={draft.description ?? ""}
          onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
        />
      </label>

      <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-center">
        <div className="flex flex-wrap gap-2 text-xs">
          <label
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-medium ${
              draft.requiresProof
                ? "border-stat-orange/60 bg-stat-orange text-stat-orange-fg"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            <input
              className={compactCheckboxClass}
              type="checkbox"
              checked={draft.requiresProof}
              onChange={(event) =>
                setDraft((value) => ({ ...value, requiresProof: event.target.checked }))
              }
            />
            Justificatif requis
          </label>
          <label
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-medium ${
              draft.paid
                ? "border-status-valid/60 bg-status-valid text-status-valid-fg"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            <input
              className={compactCheckboxClass}
              type="checkbox"
              checked={draft.paid}
              onChange={(event) => setDraft((value) => ({ ...value, paid: event.target.checked }))}
            />
            Congé payé
          </label>
          <label
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 font-medium ${
              draft.active
                ? "border-stat-blue/60 bg-stat-blue text-stat-blue-fg"
                : "border-status-rejected/60 bg-status-rejected text-status-rejected-fg"
            }`}
          >
            <input
              className={compactCheckboxClass}
              type="checkbox"
              checked={draft.active}
              onChange={(event) =>
                setDraft((value) => ({ ...value, active: event.target.checked }))
              }
            />
            Actif
          </label>
        </div>

        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button variant="outline" className="justify-center" onClick={onCancel}>
            <X className="size-4" /> Annuler
          </Button>
          <Button className="justify-center" disabled={isSaving || isDeleting} onClick={onSave}>
            <Save className="size-4" /> Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}

function LeaveTypeRow({
  leaveType,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: {
  leaveType: RhLeaveType;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (id: string, payload: LeaveTypePayload) => void;
  onDelete: (leaveType: RhLeaveType) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<LeaveTypePayload>(() => leaveTypeToDraft(leaveType));

  useEffect(() => {
    setDraft(leaveTypeToDraft(leaveType));
  }, [leaveType]);

  const openEditor = () => {
    setDraft(leaveTypeToDraft(leaveType));
    setIsEditing(true);
  };

  const saveDraft = () => {
    onSave(leaveType.id, draft);
    setIsEditing(false);
  };

  return (
    <>
      <tr
        className={`group border-b border-border/70 align-middle transition-colors last:border-0 hover:bg-accent/25 ${
          leaveType.active ? "" : "bg-muted/25 text-muted-foreground"
        }`}
      >
        <td className="px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="mt-2 size-3 shrink-0 rounded-full ring-4 ring-background shadow-sm"
              style={{ backgroundColor: leaveType.color ?? "#2563EB" }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex shrink-0 justify-center rounded-md border bg-background px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                  {leaveType.code}
                </span>
                <span className="truncate font-semibold text-foreground">{leaveType.name}</span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {leaveType.description || "Aucune description"}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3.5">
          <span className="inline-flex rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            {categoryLabel[leaveType.category]}
          </span>
        </td>
        <td className="px-3 py-3.5">
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {leaveType.defaultDays}{" "}
            <span className="text-xs font-medium text-muted-foreground">j</span>
          </div>
        </td>
        <td className="px-3 py-3.5">
          <div className="flex flex-wrap gap-1.5 text-xs font-medium">
            <span
              className={`rounded-md px-2 py-1 ${
                leaveType.active
                  ? "bg-stat-blue text-stat-blue-fg"
                  : "bg-status-rejected text-status-rejected-fg"
              }`}
            >
              {leaveType.active ? "Actif" : "Archivé"}
            </span>
            <span
              className={`rounded-md px-2 py-1 ${
                leaveType.requiresProof
                  ? "bg-stat-orange text-stat-orange-fg"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {leaveType.requiresProof ? "Justificatif" : "Sans justificatif"}
            </span>
            <span
              className={`rounded-md px-2 py-1 ${
                leaveType.paid
                  ? "bg-status-valid text-status-valid-fg"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {leaveType.paid ? "Payé" : "Sans solde"}
            </span>
          </div>
        </td>
        <td className="px-3 py-3.5">
          <LeaveTypeActionsMenu
            leaveType={leaveType}
            disabled={isSaving || isDeleting}
            onEdit={openEditor}
            onDelete={() => onDelete(leaveType)}
          />
        </td>
      </tr>

      {isEditing && (
        <tr className="border-b border-border/70 bg-muted/20">
          <td colSpan={5} className="px-5 py-4">
            <LeaveTypeEditor
              draft={draft}
              setDraft={setDraft}
              isSaving={isSaving}
              isDeleting={isDeleting}
              onCancel={() => setIsEditing(false)}
              onSave={saveDraft}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function LeaveTypeCard({
  leaveType,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: {
  leaveType: RhLeaveType;
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (id: string, payload: LeaveTypePayload) => void;
  onDelete: (leaveType: RhLeaveType) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<LeaveTypePayload>(() => leaveTypeToDraft(leaveType));

  useEffect(() => {
    setDraft(leaveTypeToDraft(leaveType));
  }, [leaveType]);

  const openEditor = () => {
    setDraft(leaveTypeToDraft(leaveType));
    setIsEditing(true);
  };

  const saveDraft = () => {
    onSave(leaveType.id, draft);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <article className="scroll-mt-24 rounded-lg border bg-card p-3 shadow-sm sm:p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="size-3 shrink-0 rounded-full ring-4 ring-background shadow-sm"
            style={{ backgroundColor: leaveType.color ?? "#2563EB" }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex justify-center rounded-md border bg-background px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                {leaveType.code}
              </span>
              <h4 className="min-w-0 truncate font-semibold text-foreground">
                Modifier {leaveType.name}
              </h4>
            </div>
          </div>
        </div>

        <LeaveTypeEditor
          className="mt-4 border-t pt-4"
          variant="plain"
          draft={draft}
          setDraft={setDraft}
          isSaving={isSaving}
          isDeleting={isDeleting}
          onCancel={() => setIsEditing(false)}
          onSave={saveDraft}
        />
      </article>
    );
  }

  return (
    <article
      className={`scroll-mt-24 rounded-lg border bg-card p-3 shadow-sm sm:p-4 ${
        leaveType.active ? "" : "bg-muted/25 text-muted-foreground"
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-2 size-3 shrink-0 rounded-full ring-4 ring-background shadow-sm"
            style={{ backgroundColor: leaveType.color ?? "#2563EB" }}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex justify-center rounded-md border bg-background px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                {leaveType.code}
              </span>
              <h4 className="min-w-0 truncate font-semibold text-foreground">{leaveType.name}</h4>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {leaveType.description || "Aucune description"}
            </p>
          </div>
        </div>
        <LeaveTypeActionsMenu
          leaveType={leaveType}
          disabled={isSaving || isDeleting}
          onEdit={openEditor}
          onDelete={() => onDelete(leaveType)}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-[170px_100px_1fr]">
        <div className="rounded-md bg-muted/55 px-3 py-2">
          <div className="text-muted-foreground">Catégorie</div>
          <div className="mt-1 font-semibold text-foreground">
            {categoryLabel[leaveType.category]}
          </div>
        </div>
        <div className="rounded-md bg-muted/55 px-3 py-2">
          <div className="text-muted-foreground">Quota</div>
          <div className="mt-1 font-semibold text-foreground">{leaveType.defaultDays} j</div>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-md bg-muted/35 px-3 py-2 font-medium sm:col-span-2 lg:col-span-1">
          <span
            className={`rounded-md px-2 py-1 ${
              leaveType.active
                ? "bg-stat-blue text-stat-blue-fg"
                : "bg-status-rejected text-status-rejected-fg"
            }`}
          >
            {leaveType.active ? "Actif" : "Archivé"}
          </span>
          <span
            className={`rounded-md px-2 py-1 ${
              leaveType.requiresProof
                ? "bg-stat-orange text-stat-orange-fg"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {leaveType.requiresProof ? "Justificatif" : "Sans justificatif"}
          </span>
          <span
            className={`rounded-md px-2 py-1 ${
              leaveType.paid
                ? "bg-status-valid text-status-valid-fg"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {leaveType.paid ? "Payé" : "Sans solde"}
          </span>
        </div>
      </div>
    </article>
  );
}

export function RhParametres() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(String(currentYear));
  const [newLeaveType, setNewLeaveType] = useState<LeaveTypePayload>(emptyLeaveType);

  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["rh-settings", year],
    queryFn: () => apiFetch<RhSettingsResponse>(settingsPath(year)),
  });

  const seedDefaults = useMutation({
    mutationFn: () =>
      apiFetch<RhLeaveType[]>("/rh/settings/leave-types/defaults", { method: "POST" }),
    onSuccess: () => {
      toast.success("Référentiel de congés créé");
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    },
  });

  const createLeaveType = useMutation({
    mutationFn: (payload: LeaveTypePayload) =>
      apiFetch<RhLeaveType>("/rh/settings/leave-types", {
        method: "POST",
        body: JSON.stringify(toPayload(payload)),
      }),
    onSuccess: () => {
      toast.success("Type de congé ajouté");
      setNewLeaveType(emptyLeaveType);
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    },
  });

  const updateLeaveType = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: LeaveTypePayload }) =>
      apiFetch<RhLeaveType>(`/rh/settings/leave-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify(toPayload(payload)),
      }),
    onSuccess: () => {
      toast.success("Type de congé mis à jour");
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    },
  });

  const deleteLeaveType = useMutation({
    mutationFn: (id: string) =>
      apiFetch<DeleteLeaveTypeResponse>(`/rh/settings/leave-types/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (result) => {
      if (result.mode === "deleted") {
        toast.success("Type de congé supprimé");
      } else {
        toast.success("Type de congé archivé", {
          description:
            "Des soldes ou demandes existent déjà pour ce type. Il est désactivé pour préserver l'historique.",
        });
      }

      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    },
    onError: (error) => {
      toast.error("Suppression impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const initializeBalances = useMutation({
    mutationFn: () =>
      apiFetch<{
        year: number;
        created: number;
        updated: number;
        skipped: number;
        balanceSummary: BalanceSummary;
      }>("/rh/settings/balances/initialize", {
        method: "POST",
        body: JSON.stringify({ year: Number(year) }),
      }),
    onSuccess: (result) => {
      toast.success(`${result.created} solde(s) créé(s), ${result.updated} mis à jour`);
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    },
  });

  const leaveTypes = data?.leaveTypes ?? [];
  const summary = data?.balanceSummary ?? {
    year: Number(year),
    employees: 0,
    leaveTypes: 0,
    expectedBalances: 0,
    existingBalances: 0,
    missingBalances: 0,
  };

  return (
    <AppShell title="Paramètres RH" subtitle="Référentiel des congés et initialisation annuelle">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
          <Settings2 className="size-4" /> Configuration RH opérationnelle
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Actualiser
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Employés à couvrir"
          value={isLoading ? "..." : summary.employees}
          tone="blue"
        />
        <StatCard
          label="Types actifs"
          value={isLoading ? "..." : summary.leaveTypes}
          tone="purple"
        />
        <StatCard
          label="Soldes existants"
          value={isLoading ? "..." : summary.existingBalances}
          tone="green"
        />
        <StatCard
          label="Soldes manquants"
          value={isLoading ? "..." : summary.missingBalances}
          tone={summary.missingBalances ? "red" : "green"}
        />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger les paramètres RH depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title={`Initialisation des soldes ${year}`}
          action={
            <Button
              disabled={initializeBalances.isPending || !summary.leaveTypes}
              onClick={() => initializeBalances.mutate()}
            >
              <CheckCircle2 className="size-4" /> Initialiser / synchroniser les soldes
            </Button>
          }
        />
        <div className="p-5 grid gap-4 md:grid-cols-3 text-sm">
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">Soldes attendus</div>
            <div className="mt-1 text-2xl font-semibold">{summary.expectedBalances}</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">Déjà initialisés</div>
            <div className="mt-1 text-2xl font-semibold">{summary.existingBalances}</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">À créer</div>
            <div className="mt-1 text-2xl font-semibold">{summary.missingBalances}</div>
          </div>
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="grid gap-3 border-b px-4 py-4 sm:px-5 lg:flex lg:items-center lg:justify-between">
          <h3 className="font-semibold">Référentiel des types de congés</h3>
          <div className="grid gap-2 sm:flex sm:justify-start lg:justify-end">
            <Button
              variant="outline"
              className="justify-center"
              disabled={seedDefaults.isPending}
              onClick={() => seedDefaults.mutate()}
            >
              <RotateCcw className="size-4" /> Créer le référentiel par défaut
            </Button>
          </div>
        </div>
        <div className="border-b bg-muted/20 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="info">{leaveTypes.length} type(s)</Badge>
            <Badge tone="valid">
              {leaveTypes.filter((leaveType) => leaveType.active).length} actif(s)
            </Badge>
            {leaveTypes.some((leaveType) => !leaveType.active) && (
              <Badge tone="pending">
                {leaveTypes.filter((leaveType) => !leaveType.active).length} archivé(s)
              </Badge>
            )}
          </div>
        </div>
        <div className="grid gap-3 p-3 sm:p-4 xl:hidden">
          {leaveTypes.map((leaveType) => (
            <LeaveTypeCard
              key={leaveType.id}
              leaveType={leaveType}
              isSaving={updateLeaveType.isPending}
              isDeleting={deleteLeaveType.isPending}
              onSave={(id, payload) => updateLeaveType.mutate({ id, payload })}
              onDelete={(typeToDelete) => {
                const confirmed = window.confirm(
                  `Supprimer le type de congé ${typeToDelete.code} - ${typeToDelete.name} ?`,
                );

                if (confirmed) deleteLeaveType.mutate(typeToDelete.id);
              }}
            />
          ))}
          {!leaveTypes.length && (
            <div className="rounded-md border border-dashed bg-muted/30 py-8 text-center text-sm text-muted-foreground">
              Aucun type de congé configuré.
            </div>
          )}
        </div>
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-[40%]" />
              <col className="w-[17%]" />
              <col className="w-[9%]" />
              <col className="w-[24%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="bg-muted/55 text-xs font-semibold text-muted-foreground">
              <tr className="text-left">
                <th className="px-5 py-3" scope="col">
                  Type de congé
                </th>
                <th className="px-3 py-3" scope="col">
                  Catégorie
                </th>
                <th className="px-3 py-3" scope="col">
                  Quota
                </th>
                <th className="px-3 py-3" scope="col">
                  État et règles
                </th>
                <th className="px-3 py-3 text-right" scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {leaveTypes.map((leaveType) => (
                <LeaveTypeRow
                  key={leaveType.id}
                  leaveType={leaveType}
                  isSaving={updateLeaveType.isPending}
                  isDeleting={deleteLeaveType.isPending}
                  onSave={(id, payload) => updateLeaveType.mutate({ id, payload })}
                  onDelete={(typeToDelete) => {
                    const confirmed = window.confirm(
                      `Supprimer le type de congé ${typeToDelete.code} - ${typeToDelete.name} ?`,
                    );

                    if (confirmed) deleteLeaveType.mutate(typeToDelete.id);
                  }}
                />
              ))}
              {!leaveTypes.length && (
                <tr>
                  <td className="px-5 py-6" colSpan={5}>
                    <div className="rounded-md border border-dashed bg-muted/30 py-8 text-center text-sm text-muted-foreground">
                      Aucun type de congé configuré.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Ajouter un type de congé" />
        <div className="p-5 grid gap-3 lg:grid-cols-[100px_1.5fr_1fr_120px_90px_1fr_auto] items-end">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Code</span>
            <input
              className="rounded-md border px-3 py-2 bg-background"
              value={newLeaveType.code}
              onChange={(event) =>
                setNewLeaveType((value) => ({ ...value, code: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Nom</span>
            <input
              className="rounded-md border px-3 py-2 bg-background"
              value={newLeaveType.name}
              onChange={(event) =>
                setNewLeaveType((value) => ({ ...value, name: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Catégorie</span>
            <select
              className="rounded-md border px-3 py-2 bg-background"
              value={newLeaveType.category}
              onChange={(event) =>
                setNewLeaveType((value) => ({
                  ...value,
                  category: event.target.value as LeaveCategory,
                }))
              }
            >
              {categoryOptions.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Quota</span>
            <input
              className="rounded-md border px-3 py-2 bg-background"
              min="0"
              step="0.5"
              type="number"
              value={newLeaveType.defaultDays}
              onChange={(event) =>
                setNewLeaveType((value) => ({ ...value, defaultDays: Number(event.target.value) }))
              }
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Couleur</span>
            <input
              className="h-10 rounded-md border bg-background"
              type="color"
              value={newLeaveType.color ?? "#2563EB"}
              onChange={(event) =>
                setNewLeaveType((value) => ({ ...value, color: event.target.value }))
              }
            />
          </label>
          <div className="grid gap-2 text-xs pb-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newLeaveType.requiresProof}
                onChange={(event) =>
                  setNewLeaveType((value) => ({ ...value, requiresProof: event.target.checked }))
                }
              />
              Justificatif requis
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newLeaveType.paid}
                onChange={(event) =>
                  setNewLeaveType((value) => ({ ...value, paid: event.target.checked }))
                }
              />
              Congé payé
            </label>
          </div>
          <Button
            disabled={
              createLeaveType.isPending || !newLeaveType.code.trim() || !newLeaveType.name.trim()
            }
            onClick={() => createLeaveType.mutate(newLeaveType)}
          >
            Ajouter
          </Button>
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={summary.missingBalances ? "pending" : "valid"}>
            {summary.missingBalances ? "Action requise" : "Soldes complets"}
          </Badge>
          <span>
            L'initialisation crée les soldes absents et met à jour les jours acquis des soldes
            existants sans écraser les jours pris, planifiés ou reportés.
          </span>
        </div>
      </Card>
    </AppShell>
  );
}
