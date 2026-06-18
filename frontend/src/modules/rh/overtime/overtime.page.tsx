import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

type RhOvertimeRow = {
  id: string;
  reference: string;
  employeeName: string;
  matricule: string;
  departmentCode: string;
  department: string;
  workDateLabel: string;
  workDate: string;
  hours: number;
  reason: string;
  statusCode: "PENDING_MANAGER" | "IN_REVIEW_RH" | "APPROVED" | "REJECTED" | "CANCELLED";
  status: "pending" | "review" | "valid" | "rejected" | "neutral";
  statusLabel: string;
  managerComment: string;
  rhComment: string;
};

type RhOvertimeResponse = {
  year: number;
  departments: Array<{ code: string; name: string }>;
  rows: RhOvertimeRow[];
  totals: {
    total: number;
    pendingManager: number;
    pendingRh: number;
    approved: number;
    rejected: number;
    approvedHours: number;
  };
  monthlyApproved: number[];
  byDepartment: Array<{
    departmentCode: string;
    departmentName: string;
    approvedHours: number;
    approvedCount: number;
  }>;
};

const emptyRows: RhOvertimeRow[] = [];
const emptyTotals: RhOvertimeResponse["totals"] = {
  total: 0,
  pendingManager: 0,
  pendingRh: 0,
  approved: 0,
  rejected: 0,
  approvedHours: 0,
};

function buildPath(year: number, department: string) {
  const params = new URLSearchParams({ year: String(year) });
  if (department !== "ALL") params.set("department", department);
  return `/rh/overtime?${params.toString()}`;
}

export function RhOvertimePage() {
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const [year, setYear] = useState(new Date().getFullYear());
  const [department, setDepartment] = useState("ALL");
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["rh-overtime", year, department],
    queryFn: () => apiFetch<RhOvertimeResponse>(buildPath(year, department)),
  });

  const rows = query.data?.rows ?? emptyRows;
  const totals = query.data?.totals ?? emptyTotals;
  const departments = query.data?.departments ?? [];
  const byDepartment = query.data?.byDepartment ?? [];
  const monthlyApproved = query.data?.monthlyApproved ?? new Array<number>(12).fill(0);

  const actionable = useMemo(
    () => rows.filter((row) => row.statusCode === "IN_REVIEW_RH"),
    [rows],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-overtime"] });
  };

  const decisionMutation = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment?: string }) =>
      apiFetch<RhOvertimeRow>(`/rh/overtime/${id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session!.id,
          rhEmail: session!.email,
          decision,
          comment,
        }),
      }),
    onSuccess: (_, variables) => {
      toast.success(variables.decision === "approve" ? "Heure supplémentaire comptabilisée" : "Heure supplémentaire rejetée");
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
    <AppShell title="Heures supplémentaires" subtitle="Validation RH finale et vue globale des heures comptabilisées.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Déclarations" value={totals.total} tone="blue" />
        <StatCard label="Attente N+1" value={totals.pendingManager} tone="yellow" />
        <StatCard label="Attente RH" value={totals.pendingRh} tone="orange" />
        <StatCard label="Approuvées" value={totals.approved} tone="green" />
        <StatCard label="Refusées" value={totals.rejected} tone="red" />
        <StatCard label="Heures comptabilisées" value={totals.approvedHours} suffix="h" tone="purple" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Décisions RH"
          action={
            <div className="flex items-center gap-2">
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
              <input
                className="w-24 rounded-md border bg-card px-3 py-2 text-sm"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(Number(event.target.value) || new Date().getFullYear())}
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
                <th className="px-5 py-3">Commentaires</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const canDecide = row.statusCode === "IN_REVIEW_RH";
                return (
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
                      {canDecide ? (
                        <input
                          className="w-full rounded-md border bg-card px-2 py-1"
                          value={commentById[row.id] ?? ""}
                          onChange={(event) =>
                            setCommentById((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                          placeholder="Optionnel pour validation, requis pour refus"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {row.rhComment || row.managerComment || "-"}
                        </span>
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
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={7}>
                    Aucune déclaration d'heure supplémentaire.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Heures approuvées par département" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Département</th>
                  <th className="px-5 py-3">Demandes</th>
                  <th className="px-5 py-3">Heures</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {byDepartment.map((row) => (
                  <tr key={row.departmentCode}>
                    <td className="px-5 py-3">{row.departmentName}</td>
                    <td className="px-5 py-3">{row.approvedCount}</td>
                    <td className="px-5 py-3">{row.approvedHours} h</td>
                  </tr>
                ))}
                {byDepartment.length === 0 && (
                  <tr>
                    <td className="px-5 py-8 text-center text-muted-foreground" colSpan={3}>
                      Aucune heure approuvée pour cette période.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Heures approuvées par mois" />
          <div className="grid grid-cols-2 gap-2 p-5 md:grid-cols-3">
            {monthlyApproved.map((value, index) => (
              <div key={index} className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(new Date(Date.UTC(2020, index, 1)))}</div>
                <div className="mt-1 text-lg font-semibold">{value} h</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {actionable.length === 0 && !query.isLoading && (
        <p className="mt-4 text-xs text-muted-foreground">Aucune déclaration en attente RH.</p>
      )}
    </AppShell>
  );
}
