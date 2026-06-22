import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

type ManagerOvertimeRow = {
  id: string;
  reference: string;
  employeeName: string;
  matricule: string;
  department: string;
  workDateLabel: string;
  hours: number;
  reason: string;
  statusCode: "PENDING_MANAGER" | "IN_REVIEW_RH" | "APPROVED" | "REJECTED" | "CANCELLED";
  status: "pending" | "review" | "valid" | "rejected" | "neutral";
  statusLabel: string;
  managerComment: string;
  rhComment: string;
  canDecide: boolean;
};

type ManagerOvertimeResponse = {
  year: number;
  manager: {
    id: string;
    name: string;
    department: { id: string; code: string; name: string } | null;
    managedDepartments: { id: string; code: string; name: string }[];
  };
  rows: ManagerOvertimeRow[];
  totals: {
    total: number;
    pendingManager: number;
    pendingRh: number;
    approved: number;
    rejected: number;
    approvedHours: number;
  };
};

const emptyRows: ManagerOvertimeRow[] = [];
const emptyTotals: ManagerOvertimeResponse["totals"] = {
  total: 0,
  pendingManager: 0,
  pendingRh: 0,
  approved: 0,
  rejected: 0,
  approvedHours: 0,
};

function buildPath(session: { id: string; email: string }, year: number) {
  const params = new URLSearchParams({
    managerId: session.id,
    managerEmail: session.email,
    year: String(year),
  });
  return `/manager/overtime?${params.toString()}`;
}

export function ManagerOvertimePage() {
  const queryClient = useQueryClient();
  const { ready, session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["manager-overtime", session?.id, session?.email, year],
    queryFn: () => apiFetch<ManagerOvertimeResponse>(buildPath(session!, year)),
    enabled: ready && !!session?.id && !!session?.email,
  });

  const rows = query.data?.rows ?? emptyRows;
  const totals = query.data?.totals ?? emptyTotals;

  const actionableRows = useMemo(
    () => rows.filter((row) => row.statusCode === "PENDING_MANAGER" && row.canDecide),
    [rows],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["manager-overtime"] });
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
      apiFetch<ManagerOvertimeRow>(`/manager/overtime/${id}/decision`, {
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
        variables.decision === "approve" ? "Déclaration transmise RH" : "Déclaration refusée",
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

  const isMutating = decisionMutation.isPending;

  return (
    <AppShell title="Heures supplémentaires" subtitle="Validation N+1 avant transmission RH.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Déclarations" value={totals.total} tone="blue" />
        <StatCard label="À valider N+1" value={totals.pendingManager} tone="yellow" />
        <StatCard label="Chez RH" value={totals.pendingRh} tone="orange" />
        <StatCard label="Approuvées" value={totals.approved} tone="green" />
        <StatCard label="Refusées" value={totals.rejected} tone="red" />
        <StatCard label="Heures validées" value={totals.approvedHours} suffix="h" tone="purple" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="File de validation manager"
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
                <th className="px-5 py-3">Employé</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Heures</th>
                <th className="px-5 py-3">Motif</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Commentaire</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{row.employeeName}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.matricule} · {row.department}
                    </div>
                  </td>
                  <td className="px-5 py-3">{row.workDateLabel}</td>
                  <td className="px-5 py-3">{row.hours} h</td>
                  <td className="px-5 py-3">{row.reason || "-"}</td>
                  <td className="px-5 py-3">
                    <Badge tone={row.status}>{row.statusLabel}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    {row.canDecide && row.statusCode === "PENDING_MANAGER" ? (
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
                      <span className="text-xs text-muted-foreground">
                        {row.managerComment || row.rhComment || "-"}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {row.canDecide && row.statusCode === "PENDING_MANAGER" && (
                      <div className="inline-flex gap-2">
                        <Button
                          className="px-2 py-1"
                          disabled={isMutating}
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
                          disabled={isMutating}
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
              ))}
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

      {actionableRows.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">
          Rien à valider pour le moment sur votre périmètre.
        </p>
      )}
    </AppShell>
  );
}
