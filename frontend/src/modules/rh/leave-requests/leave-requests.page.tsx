import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { AlertCircle, Download, RefreshCw, Search } from "lucide-react";

type BadgeTone =
  | "valid"
  | "pending"
  | "rejected"
  | "draft"
  | "info"
  | "neutral"
  | "review"
  | "planned";

type DepartmentOption = {
  code: string;
  name: string;
};

type PlanificationRow = {
  id: string;
  reference: string;
  employee: string;
  manager: string;
  departmentCode: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  statusCode: string;
  status: BadgeTone;
  label: string;
};

type GlobalViewResponse = {
  year: number;
  departments: DepartmentOption[];
  planifications: PlanificationRow[];
};

const currentYear = new Date().getFullYear();
const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

type ProcessedFilter = "ALL" | "APPROVED" | "REJECTED" | "CANCELLED";

function buildGlobalViewPath(year: string, department: string) {
  const params = new URLSearchParams({ year });
  if (department !== "ALL") params.set("department", department);

  return `/rh/global-view?${params.toString()}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportRowCsv(row: PlanificationRow) {
  const headers = [
    "Référence",
    "Employé",
    "Département",
    "Début",
    "Fin",
    "Jours",
    "Type",
    "Statut",
  ];
  const values = [
    row.reference,
    row.employee,
    row.departmentName,
    row.startDate,
    row.endDate,
    formatNumber(row.days),
    row.type,
    row.label,
  ];
  const csv = [headers, values].map((line) => line.map((cell) => escapeCsvValue(cell)).join(";")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `demande-${row.reference}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RhDemandesConges() {
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const [year, setYear] = useState(String(currentYear));
  const [department, setDepartment] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [processedFilter, setProcessedFilter] = useState<ProcessedFilter>("ALL");
  const [query, setQuery] = useState("");
  const [remarkDialog, setRemarkDialog] = useState<PlanificationRow | null>(null);
  const [remark, setRemark] = useState("");

  const queryKey = ["rh-leave-requests", year, department];

  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => apiFetch<GlobalViewResponse>(buildGlobalViewPath(year, department)),
  });

  const rhDecisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          decision,
        }),
      });
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approve" ? "Demande confirmée par RH" : "Demande rejetée par RH",
      );
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Décision RH impossible");
    },
  });

  const rhRemarkMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${id}/remark`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          comment,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Remarque RH enregistrée", {
        description: "La remarque sera visible dans le détail de la demande pour le demandeur et le N+1.",
      });
      setRemarkDialog(null);
      setRemark("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer la remarque RH");
    },
  });

  const planifications = data?.planifications ?? [];
  const typeOptions = useMemo(
    () => Array.from(new Set(planifications.map((row) => row.type))).sort((a, b) => a.localeCompare(b)),
    [planifications],
  );

  const searchText = query.trim().toLowerCase();
  const baseFiltered = planifications.filter((row) => {
    if (typeFilter !== "ALL" && row.type !== typeFilter) return false;
    if (!searchText) return true;

    return [row.reference, row.employee, row.departmentName, row.departmentCode]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });

  const managerPendingRows = baseFiltered.filter((row) => row.statusCode === "PENDING");
  const rhPendingRows = baseFiltered.filter((row) => row.statusCode === "IN_REVIEW");
  const plannedRows = baseFiltered.filter((row) => row.statusCode === "DRAFT");
  const processedRows = baseFiltered.filter((row) => {
    if (!["APPROVED", "REJECTED", "CANCELLED"].includes(row.statusCode)) return false;
    if (processedFilter === "ALL") return true;
    return row.statusCode === processedFilter;
  });

  return (
    <AppShell
      title="Demande et Planification"
      subtitle="Suivi RH des demandes en attente N+1, validations RH et historique traité"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
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
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        >
          <option value="ALL">Tous départements</option>
          {(data?.departments ?? []).map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
        >
          <option value="ALL">Tous types</option>
          {typeOptions.map((type) => (
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
          <option value="APPROVED">Historique: approuvées</option>
          <option value="REJECTED">Historique: rejetées</option>
          <option value="CANCELLED">Historique: annulées</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher référence, employé..."
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Attente action N+1" value={isLoading ? "..." : managerPendingRows.length} tone="orange" />
        <StatCard label="Attente validation RH" value={isLoading ? "..." : rhPendingRows.length} tone="yellow" />
        <StatCard label="Congés planifiés" value={isLoading ? "..." : plannedRows.length} tone="blue" />
        <StatCard label="Total filtré" value={isLoading ? "..." : baseFiltered.length} tone="blue" />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger les demandes de congés RH.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Tabs defaultValue="n1" className="mt-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="n1">En attente d'action N+1 ({managerPendingRows.length})</TabsTrigger>
          <TabsTrigger value="rh">En attente validation RH ({rhPendingRows.length})</TabsTrigger>
          <TabsTrigger value="planned">Congés planifiés ({plannedRows.length})</TabsTrigger>
          <TabsTrigger value="history">Historique traité ({processedRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="n1" className="mt-4">
          <Card>
            <CardHeader
              title="Demandes en attente d'action N+1"
              action={<Badge tone="pending">Niveau N+1</Badge>}
            />
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
                  {managerPendingRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.manager}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">{row.startDate} - {row.endDate}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRemarkDialog(row);
                              setRemark("");
                            }}
                          >
                            Laisser une remarque
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!managerPendingRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={9}>
                        Aucune demande en attente d'action N+1 pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="rh" className="mt-4">
          <Card>
            <CardHeader title="Demandes en attente de validation RH" />
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
                    <th className="px-5 py-3 text-right">Actions RH</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rhPendingRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">{row.startDate} - {row.endDate}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="success"
                            size="sm"
                            disabled={rhDecisionMutation.isPending}
                            onClick={() => rhDecisionMutation.mutate({ id: row.id, decision: "approve" })}
                          >
                            Valider
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={rhDecisionMutation.isPending}
                            onClick={() => rhDecisionMutation.mutate({ id: row.id, decision: "reject" })}
                          >
                            Rejeter
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rhPendingRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={8}>
                        Aucune demande en attente de validation RH pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="planned" className="mt-4">
          <Card>
            <CardHeader title="Tous les congés planifiés de l'entreprise" />
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
                  {plannedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.manager}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">{row.startDate} - {row.endDate}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/rh/global">Ouvrir</Link>
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => exportRowCsv(row)}>
                            <Download className="size-4" /> Exporter
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!plannedRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={9}>
                        Aucun congé planifié trouvé pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader title="Historique des demandes traitées (N+1 + RH)" />
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
                    <th className="px-5 py-3">Statut final</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {processedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">{row.startDate} - {row.endDate}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/rh/global">Ouvrir</Link>
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => exportRowCsv(row)}>
                            <Download className="size-4" /> Exporter
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!processedRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={8}>
                        Aucune demande traitée trouvée pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!remarkDialog} onOpenChange={(open) => !open && setRemarkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une remarque RH</DialogTitle>
            <DialogDescription>
              Cette remarque sera visible dans le détail de la demande pour le demandeur et le N+1.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {remarkDialog ? `Demande ${remarkDialog.reference} · ${remarkDialog.employee}` : ""}
            </div>
            <textarea
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ex: Merci de compléter le motif ou de vérifier les dates avant validation N+1."
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemarkDialog(null);
                setRemark("");
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!remarkDialog) return;
                rhRemarkMutation.mutate({ id: remarkDialog.id, comment: remark.trim() });
              }}
              disabled={!remark.trim() || rhRemarkMutation.isPending}
            >
              Enregistrer la remarque
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
