import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  allDateRange,
  isDateInRange,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Baby, CalendarDays, Gift, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ChildSexe = "M" | "F";
type ChildStatus = "valid" | "expired" | "not_eligible";
type EmployeeStatus = "active" | "leave" | "inactive";

type RhEmployee = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  sexe: ChildSexe;
  dept: string;
  status: EmployeeStatus;
};

type RhChild = {
  id: string;
  parentId: string;
  parentName: string;
  parentMatricule: string;
  department: string;
  nom: string;
  prenom: string;
  childName: string;
  dateNaissance: string;
  sexe: ChildSexe;
  ageYears: number;
  ageLabel: string;
  bonusDays: number;
  bonusLabel: string;
  eligibleUntil: string;
  status: ChildStatus;
  statusLabel: string;
};

type ChildPayload = {
  parentId: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: ChildSexe;
};

const emptyChild: ChildPayload = {
  parentId: "",
  nom: "",
  prenom: "",
  dateNaissance: "",
  sexe: "M",
};

const emptyChildren: RhChild[] = [];
const emptyEmployees: RhEmployee[] = [];

const statusTone: Record<ChildStatus, "valid" | "pending" | "neutral"> = {
  valid: "valid",
  expired: "pending",
  not_eligible: "neutral",
};

const sexeLabel: Record<ChildSexe, string> = {
  M: "Garçon",
  F: "Fille",
};

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function normalizeChildPayload(payload: ChildPayload): ChildPayload {
  return {
    ...payload,
    nom: payload.nom.trim().toUpperCase(),
    prenom: payload.prenom.trim(),
  };
}

function formatEmployeeLabel(employee: RhEmployee) {
  return `${employee.matricule} - ${employee.prenom} ${employee.nom}`;
}

function ChildForm({
  draft,
  employees,
  disabled,
  submitLabel,
  onCancel,
  onSubmit,
  setDraft,
}: {
  draft: ChildPayload;
  employees: RhEmployee[];
  disabled: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: () => void;
  setDraft: React.Dispatch<React.SetStateAction<ChildPayload>>;
}) {
  const set = <K extends keyof ChildPayload>(key: K, value: ChildPayload[K]) =>
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
          <span className="text-xs font-medium text-muted-foreground">Parent *</span>
          <select
            className={inputClass}
            value={draft.parentId}
            onChange={(event) => set("parentId", event.target.value)}
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
          <span className="text-xs font-medium text-muted-foreground">Nom *</span>
          <input
            className={inputClass}
            value={draft.nom}
            onChange={(event) => set("nom", event.target.value.toUpperCase())}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Prénom *</span>
          <input
            className={inputClass}
            value={draft.prenom}
            onChange={(event) => set("prenom", event.target.value)}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Date naissance *</span>
          <input
            type="date"
            className={inputClass}
            value={draft.dateNaissance}
            onChange={(event) => set("dateNaissance", event.target.value)}
            required
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Sexe *</span>
          <select
            className={inputClass}
            value={draft.sexe}
            onChange={(event) => set("sexe", event.target.value as ChildSexe)}
            required
          >
            <option value="M">Garçon</option>
            <option value="F">Fille</option>
          </select>
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

function NewChildDialog({
  employees,
  disabled,
  onCreate,
}: {
  employees: RhEmployee[];
  disabled: boolean;
  onCreate: (payload: ChildPayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ChildPayload>(emptyChild);

  const submit = async () => {
    try {
      await onCreate(normalizeChildPayload(draft));
      toast.success("Enfant ajouté");
      setOpen(false);
      setDraft(emptyChild);
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
        if (!nextOpen) setDraft(emptyChild);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled || !employees.length}>
          <Plus className="size-4" /> Ajouter un enfant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Nouvel enfant</DialogTitle>
          <DialogDescription>
            Rattachez l'enfant à son parent employé pour calculer le bonus légal.
          </DialogDescription>
        </DialogHeader>
        <ChildForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel={disabled ? "Création..." : "Créer"}
          setDraft={setDraft}
          onSubmit={submit}
        />
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}

function EditChildDialog({
  child,
  employees,
  disabled,
  onSave,
}: {
  child: RhChild;
  employees: RhEmployee[];
  disabled: boolean;
  onSave: (id: string, payload: ChildPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ChildPayload>({
    parentId: child.parentId,
    nom: child.nom,
    prenom: child.prenom,
    dateNaissance: child.dateNaissance,
    sexe: child.sexe,
  });

  const resetDraft = () =>
    setDraft({
      parentId: child.parentId,
      nom: child.nom,
      prenom: child.prenom,
      dateNaissance: child.dateNaissance,
      sexe: child.sexe,
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetDraft();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="mr-2 px-3 py-1.5" disabled={disabled}>
          <Pencil className="size-4" /> Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Modifier {child.childName}</DialogTitle>
          <DialogDescription>
            Mettez à jour les informations déclarées pour cet enfant.
          </DialogDescription>
        </DialogHeader>
        <ChildForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel="Enregistrer"
          setDraft={setDraft}
          onCancel={() => setOpen(false)}
          onSubmit={() => {
            onSave(child.id, normalizeChildPayload(draft));
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ChildCard({
  child,
  employees,
  isSaving,
  isDeleting,
  onSave,
  onDelete,
}: {
  child: RhChild;
  employees: RhEmployee[];
  isSaving: boolean;
  isDeleting: boolean;
  onSave: (id: string, payload: ChildPayload) => void;
  onDelete: (child: RhChild) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ChildPayload>({
    parentId: child.parentId,
    nom: child.nom,
    prenom: child.prenom,
    dateNaissance: child.dateNaissance,
    sexe: child.sexe,
  });

  const save = () => {
    onSave(child.id, normalizeChildPayload(draft));
    setEditing(false);
  };

  if (editing) {
    return (
      <article className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-stat-blue text-stat-blue-fg">
            <Baby className="size-5" />
          </div>
          <div>
            <div className="font-semibold">Modifier {child.childName}</div>
            <div className="text-xs text-muted-foreground">{child.parentName}</div>
          </div>
        </div>
        <ChildForm
          draft={draft}
          employees={employees}
          disabled={isSaving || isDeleting}
          submitLabel="Enregistrer"
          setDraft={setDraft}
          onCancel={() => setEditing(false)}
          onSubmit={save}
        />
      </article>
    );
  }

  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stat-blue text-stat-blue-fg">
            <Baby className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-foreground">{child.childName}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {sexeLabel[child.sexe]} · {child.ageLabel}
            </div>
          </div>
        </div>
        <Badge tone={statusTone[child.status]}>{child.statusLabel}</Badge>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Parent</div>
          <div className="mt-1 font-medium">{child.parentName}</div>
          <div className="text-xs text-muted-foreground">{child.parentMatricule}</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Bonus enfant</div>
          <div className="mt-1 font-semibold">{child.bonusLabel} jour(s)</div>
          <div className="text-xs text-muted-foreground">
            Éligible jusqu'au {child.eligibleUntil}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          className="px-3 py-1.5"
          disabled={isSaving || isDeleting}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-4" /> Modifier
        </Button>
        <Button
          variant="danger"
          className="px-3 py-1.5"
          disabled={isSaving || isDeleting}
          onClick={() => onDelete(child)}
        >
          <Trash2 className="size-4" /> Supprimer
        </Button>
      </div>
    </article>
  );
}

export function Enfants() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ChildStatus>("");
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => allDateRange());

  const childrenQuery = useQuery({
    queryKey: ["rh-children"],
    queryFn: () => apiFetch<RhChild[]>("/rh/children"),
  });

  const employeesQuery = useQuery({
    queryKey: ["rh-employees"],
    queryFn: () => apiFetch<RhEmployee[]>("/rh/employees"),
  });

  const children = childrenQuery.data ?? emptyChildren;
  const employees = useMemo(
    () =>
      (employeesQuery.data ?? emptyEmployees).filter((employee) => employee.status !== "inactive"),
    [employeesQuery.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-children"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const createChild = useMutation({
    mutationFn: (payload: ChildPayload) =>
      apiFetch<RhChild>("/rh/children", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: refresh,
  });

  const updateChild = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ChildPayload }) =>
      apiFetch<RhChild>(`/rh/children/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Enfant mis à jour");
      refresh();
    },
    onError: (error) => {
      toast.error("Modification impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const deleteChild = useMutation({
    mutationFn: (id: string) => apiFetch<RhChild>(`/rh/children/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Enfant supprimé");
      refresh();
    },
    onError: (error) => {
      toast.error("Suppression impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const filteredChildren = useMemo(() => {
    const query = search.trim().toLowerCase();
    return children.filter((child) => {
      const matchesSearch =
        !query ||
        child.childName.toLowerCase().includes(query) ||
        child.parentName.toLowerCase().includes(query) ||
        child.parentMatricule.toLowerCase().includes(query) ||
        child.department.toLowerCase().includes(query);
      const matchesStatus = !statusFilter || child.status === statusFilter;
      const matchesDate = isDateInRange(child.dateNaissance, dateRange);
      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [children, search, statusFilter, dateRange]);

  const eligibleChildren = children.filter((child) => child.status === "valid");
  const bonusTotal = eligibleChildren.reduce((total, child) => total + child.bonusDays, 0);

  return (
    <AppShell title="Enfants" subtitle="Suivi des enfants déclarés et bonus congés associés">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="Enfants déclarés" value={children.length} tone="blue" />
        <StatCard label="Éligibles" value={eligibleChildren.length} tone="green" />
        <StatCard
          label="Bonus total"
          value={bonusTotal}
          suffix="jour(s)"
          tone={bonusTotal ? "orange" : "blue"}
        />
        <StatCard
          label="Expirés / non éligibles"
          value={children.filter((child) => child.status !== "valid").length}
          tone="purple"
        />
      </div>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title="Registre des enfants"
          action={
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <input
                  className="w-full rounded-md border bg-card py-2 pl-8 pr-3 text-sm sm:w-64"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Enfant, parent, matricule..."
                />
              </div>
              <select
                className="rounded-md border bg-card px-3 py-2 text-sm"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "" | ChildStatus)}
              >
                <option value="">Tous statuts</option>
                <option value="valid">Validés</option>
                <option value="expired">Expirés</option>
                <option value="not_eligible">Non éligibles</option>
              </select>
              <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
              <Button variant="outline" onClick={() => void childrenQuery.refetch()}>
                <RefreshCw className={`size-4 ${childrenQuery.isFetching ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
              <NewChildDialog
                employees={employees}
                disabled={createChild.isPending || employeesQuery.isLoading}
                onCreate={(payload) => createChild.mutateAsync(payload)}
              />
            </div>
          }
        />

        {childrenQuery.isError && (
          <div className="border-b bg-destructive/5 px-5 py-4 text-sm text-destructive">
            {childrenQuery.error instanceof Error
              ? childrenQuery.error.message
              : "Impossible de charger les enfants"}
          </div>
        )}

        <div className="grid gap-3 p-3 md:grid-cols-2 xl:hidden">
          {childrenQuery.isLoading && (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground md:col-span-2">
              Chargement des enfants...
            </div>
          )}
          {!childrenQuery.isLoading &&
            filteredChildren.map((child) => (
              <ChildCard
                key={child.id}
                child={child}
                employees={employees}
                isSaving={updateChild.isPending}
                isDeleting={deleteChild.isPending}
                onSave={(id, payload) => updateChild.mutate({ id, payload })}
                onDelete={(childToDelete) => {
                  if (window.confirm(`Supprimer ${childToDelete.childName} ?`)) {
                    deleteChild.mutate(childToDelete.id);
                  }
                }}
              />
            ))}
          {!childrenQuery.isLoading && !filteredChildren.length && (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground md:col-span-2">
              Aucun enfant trouvé.
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Enfant</th>
                <th className="px-5 py-3 font-medium">Parent</th>
                <th className="px-3 py-3 font-medium">Naissance</th>
                <th className="px-3 py-3 font-medium">Âge</th>
                <th className="px-3 py-3 font-medium">Éligible jusqu'au</th>
                <th className="px-3 py-3 font-medium">Bonus</th>
                <th className="px-3 py-3 font-medium">Statut</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {childrenQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-foreground">
                    Chargement des enfants...
                  </td>
                </tr>
              )}
              {!childrenQuery.isLoading &&
                filteredChildren.map((child) => (
                  <tr key={child.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-stat-blue text-stat-blue-fg">
                          <Baby className="size-4" />
                        </div>
                        <div>
                          <div className="font-medium">{child.childName}</div>
                          <div className="text-xs text-muted-foreground">
                            {sexeLabel[child.sexe]}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium">{child.parentName}</div>
                      <div className="text-xs text-muted-foreground">
                        {child.parentMatricule} · {child.department || "Sans pôle"}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <CalendarDays className="size-4" /> {child.dateNaissance}
                      </div>
                    </td>
                    <td className="px-3 py-3">{child.ageLabel}</td>
                    <td className="px-3 py-3 text-muted-foreground">{child.eligibleUntil}</td>
                    <td className="px-3 py-3">
                      <div className="inline-flex items-center gap-1 rounded-md bg-stat-orange px-2 py-1 text-xs font-semibold text-stat-orange-fg">
                        <Gift className="size-3.5" /> {child.bonusLabel} j
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={statusTone[child.status]}>{child.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <EditChildDialog
                        child={child}
                        employees={employees}
                        disabled={updateChild.isPending || deleteChild.isPending}
                        onSave={(id, payload) => updateChild.mutate({ id, payload })}
                      />
                      <Button
                        variant="danger"
                        className="px-3 py-1.5"
                        disabled={updateChild.isPending || deleteChild.isPending}
                        onClick={() => {
                          if (window.confirm(`Supprimer ${child.childName} ?`)) {
                            deleteChild.mutate(child.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4" /> Supprimer
                      </Button>
                    </td>
                  </tr>
                ))}
              {!childrenQuery.isLoading && !filteredChildren.length && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-foreground">
                    Aucun enfant trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
