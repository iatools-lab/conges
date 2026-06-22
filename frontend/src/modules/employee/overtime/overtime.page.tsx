import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

type EmployeeOvertimeRow = {
  id: string;
  reference: string;
  workDate: string;
  workDateLabel: string;
  hours: number;
  reason: string;
  statusCode: "PENDING_MANAGER" | "IN_REVIEW_RH" | "APPROVED" | "REJECTED" | "CANCELLED";
  status: "pending" | "review" | "valid" | "rejected" | "neutral";
  statusLabel: string;
  managerComment: string;
  rhComment: string;
};

type EmployeeOvertimeResponse = {
  year: number;
  rows: EmployeeOvertimeRow[];
  totals: {
    total: number;
    pendingManager: number;
    pendingRh: number;
    approved: number;
    rejected: number;
    approvedHours: number;
  };
};

type OvertimePayload = {
  workDate: string;
  hours: number;
  reason: string;
};

const emptyRows: EmployeeOvertimeRow[] = [];
const emptyTotals: EmployeeOvertimeResponse["totals"] = {
  total: 0,
  pendingManager: 0,
  pendingRh: 0,
  approved: 0,
  rejected: 0,
  approvedHours: 0,
};

function buildPath(session: { id: string; email: string }, year: number) {
  const params = new URLSearchParams({
    userId: session.id,
    userEmail: session.email,
    year: String(year),
  });

  return `/employee/overtime?${params.toString()}`;
}

export function EmployeeOvertimePage() {
  const queryClient = useQueryClient();
  const { ready, session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [draft, setDraft] = useState<OvertimePayload>({
    workDate: new Date().toISOString().slice(0, 10),
    hours: 1,
    reason: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["employee-overtime", session?.id, session?.email, year],
    queryFn: () => apiFetch<EmployeeOvertimeResponse>(buildPath(session!, year)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const rows = query.data?.rows ?? emptyRows;
  const totals = query.data?.totals ?? emptyTotals;

  const mutableRows = useMemo(
    () =>
      rows.filter((row) => row.statusCode === "PENDING_MANAGER" || row.statusCode === "REJECTED"),
    [rows],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["employee-overtime"] });
  };

  const createMutation = useMutation({
    mutationFn: (payload: OvertimePayload) =>
      apiFetch<EmployeeOvertimeRow>("/employee/overtime", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          userId: session!.id,
          userEmail: session!.email,
        }),
      }),
    onSuccess: () => {
      toast.success("Déclaration envoyée au N+1");
      setDraft({ ...draft, hours: 1, reason: "" });
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: OvertimePayload }) =>
      apiFetch<EmployeeOvertimeRow>(`/employee/overtime/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...payload,
          userId: session!.id,
          userEmail: session!.email,
        }),
      }),
    onSuccess: () => {
      toast.success("Déclaration mise à jour");
      setEditingId(null);
      refresh();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<EmployeeOvertimeRow>(`/employee/overtime/${id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({ userId: session!.id, userEmail: session!.email }),
      }),
    onSuccess: () => {
      toast.success("Déclaration annulée");
      refresh();
    },
  });

  const isMutating =
    createMutation.isPending || updateMutation.isPending || cancelMutation.isPending;

  return (
    <AppShell
      title="Heures supplémentaires"
      subtitle="Déclaration employé puis validation N+1 et RH."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Déclarations" value={totals.total} tone="blue" />
        <StatCard label="En attente N+1" value={totals.pendingManager} tone="yellow" />
        <StatCard label="En attente RH" value={totals.pendingRh} tone="orange" />
        <StatCard label="Approuvées" value={totals.approved} tone="green" />
        <StatCard label="Refusées" value={totals.rejected} tone="red" />
        <StatCard label="Heures validées" value={totals.approvedHours} suffix="h" tone="purple" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Nouvelle déclaration" />
        <div className="grid gap-3 p-5 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Date travaillée</span>
            <input
              type="date"
              className="rounded-md border bg-card px-3 py-2"
              value={draft.workDate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, workDate: event.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-muted-foreground">Heures</span>
            <input
              type="number"
              min="0.5"
              max="24"
              step="0.5"
              className="rounded-md border bg-card px-3 py-2"
              value={draft.hours}
              onChange={(event) =>
                setDraft((current) => ({ ...current, hours: Number(event.target.value) || 0 }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">Motif</span>
            <input
              className="rounded-md border bg-card px-3 py-2"
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) => ({ ...current, reason: event.target.value }))
              }
              placeholder="Intervention, incident, livraison tardive..."
            />
          </label>
        </div>
        <div className="flex justify-end border-t px-5 py-3">
          <Button
            disabled={isMutating || !draft.workDate || draft.hours <= 0}
            onClick={() => createMutation.mutate(draft)}
          >
            Déclarer
          </Button>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Suivi des déclarations"
          action={
            <div className="flex items-center gap-2">
              <input
                className="w-24 rounded-md border bg-card px-3 py-2 text-sm"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) =>
                  setYear(Number(event.target.value) || new Date().getFullYear())
                }
              />
              <Button variant="outline" onClick={refresh} disabled={query.isFetching}>
                <RefreshCw className="size-4" /> Actualiser
              </Button>
            </div>
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Référence</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Heures</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaires</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const editable =
                  row.statusCode === "PENDING_MANAGER" || row.statusCode === "REJECTED";
                const isEditing = editingId === row.id;
                const localDraft = isEditing
                  ? draft
                  : { workDate: row.workDate, hours: row.hours, reason: row.reason };

                return (
                  <tr key={row.id}>
                    <td className="px-5 py-3 font-medium">{row.reference}</td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          className="rounded-md border bg-card px-2 py-1"
                          value={localDraft.workDate}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, workDate: event.target.value }))
                          }
                        />
                      ) : (
                        row.workDateLabel
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0.5"
                          max="24"
                          step="0.5"
                          className="w-24 rounded-md border bg-card px-2 py-1"
                          value={localDraft.hours}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              hours: Number(event.target.value) || 0,
                            }))
                          }
                        />
                      ) : (
                        `${row.hours} h`
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {isEditing ? (
                        <input
                          className="w-full rounded-md border bg-card px-2 py-1"
                          value={localDraft.reason}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, reason: event.target.value }))
                          }
                        />
                      ) : (
                        row.reason || "-"
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={row.status}>{row.statusLabel}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {row.managerComment || row.rhComment || "-"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {editable && (
                        <div className="inline-flex gap-2">
                          {!isEditing ? (
                            <>
                              <Button
                                variant="outline"
                                className="px-2 py-1"
                                disabled={isMutating}
                                onClick={() => {
                                  setEditingId(row.id);
                                  setDraft({
                                    workDate: row.workDate,
                                    hours: row.hours,
                                    reason: row.reason,
                                  });
                                }}
                              >
                                Modifier
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2 py-1 text-muted-foreground"
                                disabled={isMutating}
                                onClick={() => cancelMutation.mutate(row.id)}
                              >
                                Annuler
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                className="px-2 py-1"
                                disabled={isMutating}
                                onClick={() =>
                                  updateMutation.mutate({ id: row.id, payload: draft })
                                }
                              >
                                Enregistrer
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2 py-1"
                                onClick={() => setEditingId(null)}
                              >
                                Fermer
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                    Aucune déclaration d'heure supplémentaire.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {mutableRows.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">
          Toutes vos déclarations sont traitées. Vous pouvez en créer une nouvelle si nécessaire.
        </p>
      )}
    </AppShell>
  );
}
