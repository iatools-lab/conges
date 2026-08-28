import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

type PermissionStatusCode =
  | "DRAFT"
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";
type PermissionTone = "pending" | "review" | "valid" | "rejected" | "neutral";

type PermissionRow = {
  id: string;
  reference: string;
  employeeName: string;
  matricule: string;
  departmentCode: string;
  department: string;
  permissionDate: string;
  permissionDateLabel: string;
  days: number;
  reason: string;
  statusCode: PermissionStatusCode;
  status: PermissionTone;
  statusLabel: string;
  submittedAt: string;
  submittedDate: string;
  managerName: string | null;
  rhName: string | null;
  managerComment: string;
  rhComment: string;
  canDecide: boolean;
};

type PermissionTotals = {
  total: number;
  quota: number;
  pendingManager: number;
  pendingRh: number;
  approved: number;
  rejected: number;
  cancelled: number;
  active: number;
  remaining: number;
};

type PermissionResponse = {
  year: number;
  quota: number;
  departments?: Array<{ code: string; name: string }>;
  rows: PermissionRow[];
  totals: PermissionTotals;
  byDepartment?: Array<{
    departmentCode: string;
    departmentName: string;
    total: number;
    approved: number;
  }>;
};

type PermissionDraft = {
  permissionDate: string;
  reason: string;
};

const emptyRows: PermissionRow[] = [];
const emptyTotals: PermissionTotals = {
  total: 0,
  quota: 5,
  pendingManager: 0,
  pendingRh: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
  active: 0,
  remaining: 5,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildEmployeePath(session: { id: string; email: string }, year: number) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
    year: String(year),
  });
  return `/employee/permissions?${params.toString()}`;
}

function buildManagerPath(session: { id: string; email: string }, year: number) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
    year: String(year),
  });
  return `/manager/permissions?${params.toString()}`;
}

function buildRhPath(year: number, department: string) {
  const params = new URLSearchParams({ year: String(year) });
  if (department !== "ALL") params.set("department", department);
  return `/rh/permissions?${params.toString()}`;
}

function YearSelector({
  year,
  setYear,
  onRefresh,
  refreshing,
}: {
  year: number;
  setYear: (year: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="w-24 rounded-md border bg-card px-3 py-2 text-sm"
        type="number"
        min="2000"
        max="2100"
        value={year}
        onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())}
      />
      <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Actualiser
      </Button>
    </div>
  );
}

function PermissionStats({ totals }: { totals: PermissionTotals }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Quota annuel" value={totals.quota} suffix="jours" tone="blue" />
      <StatCard label="Utilisées / engagées" value={totals.active} suffix="jours" tone="orange" />
      <StatCard label="Restantes" value={totals.remaining} suffix="jours" tone="green" />
      <StatCard label="En attente N+1" value={totals.pendingManager} tone="yellow" />
      <StatCard label="En attente RH" value={totals.pendingRh} tone="purple" />
      <StatCard label="Approuvées" value={totals.approved} tone="green" />
    </div>
  );
}

function comments(row: PermissionRow) {
  return [row.managerComment, row.rhComment].filter(Boolean).join(" · ") || "-";
}

export function EmployeePermissionsPage() {
  const queryClient = useQueryClient();
  const { ready, session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [draft, setDraft] = useState<PermissionDraft>({
    permissionDate: todayIso(),
    reason: "",
  });
  const [editing, setEditing] = useState<(PermissionDraft & { id: string }) | null>(null);

  const query = useQuery({
    queryKey: ["employee-permissions", session?.id, session?.email, year],
    queryFn: () => apiFetch<PermissionResponse>(buildEmployeePath(session!, year)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const rows = query.data?.rows ?? emptyRows;
  const totals = query.data?.totals ?? emptyTotals;
  const editableRows = useMemo(
    () => rows.filter((row) => row.statusCode === "PENDING" || row.statusCode === "REJECTED"),
    [rows],
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["employee-permissions"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: PermissionDraft) =>
      apiFetch<PermissionRow>("/employee/permissions", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          userId: session!.id,
          userEmail: session!.email,
        }),
      }),
    onSuccess: () => {
      toast.success("Permission envoyée au N+1");
      setDraft({ permissionDate: todayIso(), reason: "" });
      refresh();
    },
    onError: (error) => {
      toast.error("Demande impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: PermissionDraft & { id: string }) =>
      apiFetch<PermissionRow>(`/employee/permissions/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          permissionDate: payload.permissionDate,
          reason: payload.reason,
          userId: session!.id,
          userEmail: session!.email,
        }),
      }),
    onSuccess: () => {
      toast.success("Permission mise à jour");
      setEditing(null);
      refresh();
    },
    onError: (error) => {
      toast.error("Modification impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<PermissionRow>(`/employee/permissions/${id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ userId: session!.id, userEmail: session!.email }),
      }),
    onSuccess: () => {
      toast.success("Permission annulée");
      refresh();
    },
  });

  const busy = createMutation.isPending || updateMutation.isPending || cancelMutation.isPending;

  return (
    <AppShell title="Permissions" subtitle="Une permission vaut une journée. Quota annuel : 5.">
      <PermissionStats totals={totals} />

      <Card className="mt-6">
        <CardHeader title="Nouvelle permission" />
        <div className="grid gap-3 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Date de permission</span>
            <input
              type="date"
              className="rounded-md border bg-card px-3 py-2"
              value={draft.permissionDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, permissionDate: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Motif</span>
            <input
              className="rounded-md border bg-card px-3 py-2"
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="Ex. rendez-vous administratif, urgence familiale..."
            />
          </label>
        </div>
        <div className="flex justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
          <span>
            Restant cette année : <strong>{totals.remaining}</strong> permission(s).
          </span>
          <Button
            disabled={busy || !draft.permissionDate || totals.remaining <= 0}
            onClick={() => createMutation.mutate(draft)}
          >
            Demander une permission
          </Button>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Mes permissions"
          action={
            <YearSelector
              year={year}
              setYear={setYear}
              onRefresh={refresh}
              refreshing={query.isFetching}
            />
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Référence</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Soumission</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaires</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const editable = row.statusCode === "PENDING" || row.statusCode === "REJECTED";
                const canCancel = row.statusCode !== "APPROVED" && row.statusCode !== "CANCELLED";
                const isEditing = editing?.id === row.id;

                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{row.reference}</td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          className="rounded-md border bg-card px-2 py-1"
                          value={editing.permissionDate}
                          onChange={(event) =>
                            setEditing((current) =>
                              current
                                ? { ...current, permissionDate: event.target.value }
                                : current,
                            )
                          }
                        />
                      ) : (
                        row.permissionDateLabel
                      )}
                    </td>
                    <td className="px-5 py-3">{row.submittedDate}</td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          className="w-full rounded-md border bg-card px-2 py-1"
                          value={editing.reason}
                          onChange={(event) =>
                            setEditing((current) =>
                              current ? { ...current, reason: event.target.value } : current,
                            )
                          }
                        />
                      ) : (
                        row.reason || "-"
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={row.status}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{comments(row)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {editable && !isEditing && (
                          <Button
                            variant="outline"
                            className="px-2 py-1"
                            disabled={busy}
                            onClick={() =>
                              setEditing({
                                id: row.id,
                                permissionDate: row.permissionDate,
                                reason: row.reason,
                              })
                            }
                          >
                            Modifier
                          </Button>
                        )}
                        {isEditing && (
                          <>
                            <Button
                              className="px-2 py-1"
                              disabled={busy}
                              onClick={() => editing && updateMutation.mutate(editing)}
                            >
                              Enregistrer
                            </Button>
                            <Button
                              variant="outline"
                              className="px-2 py-1"
                              onClick={() => setEditing(null)}
                            >
                              Fermer
                            </Button>
                          </>
                        )}
                        {canCancel && (
                          <Button
                            variant="outline"
                            className="px-2 py-1 text-destructive"
                            disabled={busy}
                            onClick={() => cancelMutation.mutate(row.id)}
                          >
                            Annuler
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                    Aucune permission déclarée pour cette année.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editableRows.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">
          Les permissions validées ou en attente RH ne sont plus modifiables depuis votre espace.
        </p>
      )}
    </AppShell>
  );
}

export function ManagerPermissionsPage() {
  const queryClient = useQueryClient();
  const { ready, session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["manager-permissions", session?.id, session?.email, year],
    queryFn: () => apiFetch<PermissionResponse>(buildManagerPath(session!, year)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const rows = query.data?.rows ?? emptyRows;
  const actionableRows = rows.filter((row) => row.statusCode === "PENDING" && row.canDecide);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["manager-permissions"] });
  };

  const decisionMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: "approve" | "reject";
      comment?: string;
    }) =>
      apiFetch<PermissionRow>(`/manager/permissions/${id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          managerId: session!.id,
          managerEmail: session!.email,
          decision,
          comment,
        }),
      }),
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approve" ? "Permission transmise RH" : "Permission refusée",
      );
      setCommentById((current) => ({ ...current, [variables.id]: "" }));
      refresh();
    },
    onError: (error) => {
      toast.error("Décision impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  return (
    <AppShell title="Permissions équipe" subtitle="Validation N+1 des permissions d'une journée.">
      <Card>
        <CardHeader
          title="File de validation manager"
          action={
            <YearSelector
              year={year}
              setYear={setYear}
              onRefresh={refresh}
              refreshing={query.isFetching}
            />
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Employé</th>
                <th className="px-5 py-3">Date permission</th>
                <th className="px-5 py-3">Soumission</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaire</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const canDecide = row.statusCode === "PENDING" && row.canDecide;
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{row.employeeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.matricule} · {row.department}
                      </div>
                    </td>
                    <td className="px-5 py-3">{row.permissionDateLabel}</td>
                    <td className="px-5 py-3">{row.submittedDate}</td>
                    <td className="px-5 py-3">{row.reason || "-"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={row.status}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      {canDecide ? (
                        <input
                          className="w-full rounded-md border bg-card px-2 py-1"
                          value={commentById[row.id] ?? ""}
                          onChange={(event) =>
                            setCommentById((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          placeholder="Optionnel pour validation, requis pour refus"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{comments(row)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canDecide && (
                        <div className="inline-flex gap-2">
                          <Button
                            className="px-2 py-1"
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                id: row.id,
                                decision: "approve",
                                comment: commentById[row.id],
                              })
                            }
                          >
                            Valider
                          </Button>
                          <Button
                            variant="outline"
                            className="px-2 py-1 text-destructive"
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                id: row.id,
                                decision: "reject",
                                comment: commentById[row.id],
                              })
                            }
                          >
                            Refuser
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                    Aucune permission sur votre périmètre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {actionableRows.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">
          Rien à valider pour le moment sur votre périmètre N+1.
        </p>
      )}
    </AppShell>
  );
}

export function RhPermissionsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [department, setDepartment] = useState("ALL");
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["rh-permissions", year, department],
    queryFn: () => apiFetch<PermissionResponse>(buildRhPath(year, department)),
  });

  const rows = query.data?.rows ?? emptyRows;
  const departments = query.data?.departments ?? [];
  const byDepartment = query.data?.byDepartment ?? [];
  const actionableRows = rows.filter((row) => row.statusCode === "IN_REVIEW");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-permissions"] });
  };

  const decisionMutation = useMutation({
    mutationFn: ({
      id,
      decision,
      comment,
    }: {
      id: string;
      decision: "approve" | "reject";
      comment?: string;
    }) =>
      apiFetch<PermissionRow>(`/rh/permissions/${id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session!.id,
          rhEmail: session!.email,
          decision,
          comment,
        }),
      }),
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approve" ? "Permission approuvée" : "Permission refusée",
      );
      setCommentById((current) => ({ ...current, [variables.id]: "" }));
      refresh();
    },
    onError: (error) => {
      toast.error("Décision RH impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  return (
    <AppShell title="Permissions RH" subtitle="Validation RH finale des permissions annuelles.">
      <Card>
        <CardHeader
          title="Décisions RH"
          action={
            <div className="flex flex-wrap items-center gap-2">
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
              <YearSelector
                year={year}
                setYear={setYear}
                onRefresh={refresh}
                refreshing={query.isFetching}
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Employé</th>
                <th className="px-5 py-3">Date permission</th>
                <th className="px-5 py-3">Soumission</th>
                <th className="px-5 py-3">N+1</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaires</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const canDecide = row.statusCode === "IN_REVIEW";
                return (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{row.employeeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.matricule} · {row.department}
                      </div>
                    </td>
                    <td className="px-5 py-3">{row.permissionDateLabel}</td>
                    <td className="px-5 py-3">{row.submittedDate}</td>
                    <td className="px-5 py-3">{row.managerName ?? "Non défini"}</td>
                    <td className="px-5 py-3">{row.reason || "-"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={row.status}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      {canDecide ? (
                        <input
                          className="w-full rounded-md border bg-card px-2 py-1"
                          value={commentById[row.id] ?? ""}
                          onChange={(event) =>
                            setCommentById((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          placeholder="Optionnel pour validation, requis pour refus"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{comments(row)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canDecide && (
                        <div className="inline-flex gap-2">
                          <Button
                            className="px-2 py-1"
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                id: row.id,
                                decision: "approve",
                                comment: commentById[row.id],
                              })
                            }
                          >
                            Approuver
                          </Button>
                          <Button
                            variant="outline"
                            className="px-2 py-1 text-destructive"
                            disabled={decisionMutation.isPending}
                            onClick={() =>
                              decisionMutation.mutate({
                                id: row.id,
                                decision: "reject",
                                comment: commentById[row.id],
                              })
                            }
                          >
                            Refuser
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={8}>
                    Aucune permission pour ce périmètre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Permissions par département" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Département</th>
                <th className="px-5 py-3">Demandes</th>
                <th className="px-5 py-3">Approuvées</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {byDepartment.map((row) => (
                <tr key={row.departmentCode}>
                  <td className="px-5 py-3">{row.departmentName}</td>
                  <td className="px-5 py-3">{row.total}</td>
                  <td className="px-5 py-3">{row.approved}</td>
                </tr>
              ))}
              {byDepartment.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={3}>
                    Aucune donnée départementale.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {actionableRows.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">Aucune permission en attente RH.</p>
      )}
    </AppShell>
  );
}
