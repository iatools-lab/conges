import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type AlertSeverity = "high" | "medium" | "low";
type AlertStatus = "active" | "resolved" | "ignored";

type RhAlert = {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  employee: string;
  detail: string;
  detectedDays: number;
  rule: string;
};

type RhAlertRule = {
  id: string;
  rule: string;
  severity: AlertSeverity;
  threshold: string;
  enabled: boolean;
};

type RhAlertsResponse = {
  stats: {
    active: number;
    high: number;
    medium: number;
    resolved: number;
  };
  alerts: RhAlert[];
  rules: RhAlertRule[];
};

const severityMeta = {
  high: {
    tone: "rejected" as const,
    label: "Critique",
    icon: ShieldAlert,
    color: "text-status-rejected-fg bg-status-rejected",
  },
  medium: {
    tone: "pending" as const,
    label: "Important",
    icon: AlertTriangle,
    color: "text-status-pending-fg bg-status-pending",
  },
  low: {
    tone: "info" as const,
    label: "Information",
    icon: AlertCircle,
    color: "text-stat-blue-fg bg-stat-blue",
  },
};

const statusLabel: Record<AlertStatus, string> = {
  active: "Active",
  resolved: "Traitée",
  ignored: "Ignorée",
};

const statusTone: Record<AlertStatus, "pending" | "valid" | "neutral"> = {
  active: "pending",
  resolved: "valid",
  ignored: "neutral",
};

function buildAlertsPath(severity: string, status: string) {
  const params = new URLSearchParams();
  if (severity !== "ALL") params.set("severity", severity);
  if (status !== "ALL") params.set("status", status);
  const query = params.toString();

  return `/rh/alerts${query ? `?${query}` : ""}`;
}

export function RhAlertes() {
  const queryClient = useQueryClient();
  const [severity, setSeverity] = useState<AlertSeverity | "ALL">("ALL");
  const [status, setStatus] = useState<AlertStatus | "ALL">("active");

  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["rh-alerts", severity, status],
    queryFn: () => apiFetch<RhAlertsResponse>(buildAlertsPath(severity, status)),
  });

  const updateAlertStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: AlertStatus }) =>
      apiFetch<{ id: string; status: AlertStatus }>(`/rh/alerts/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      }),
    onSuccess: (_, variables) => {
      toast.success(variables.nextStatus === "resolved" ? "Alerte traitée" : "Alerte ignorée");
      void queryClient.invalidateQueries({ queryKey: ["rh-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    },
  });

  const updateRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch<RhAlertRule>(`/rh/alerts/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      toast.success("Règle mise à jour");
      void queryClient.invalidateQueries({ queryKey: ["rh-alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    },
  });

  const alerts = data?.alerts ?? [];
  const rules = data?.rules ?? [];
  const stats = data?.stats ?? { active: 0, high: 0, medium: 0, resolved: 0 };

  return (
    <AppShell title="Alertes conformité" subtitle="Suivi des risques légaux et obligations RH">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Alertes actives" value={isLoading ? "..." : stats.active} tone="orange" />
        <StatCard label="Critiques" value={isLoading ? "..." : stats.high} tone="red" />
        <StatCard label="Importantes" value={isLoading ? "..." : stats.medium} tone="yellow" />
        <StatCard label="Résolues" value={isLoading ? "..." : stats.resolved} tone="green" />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger les alertes RH depuis le backend.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Règles de conformité"
          action={
            <div className="flex flex-wrap gap-2">
              <select
                className="border rounded-md px-3 py-2 text-sm bg-card"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as AlertSeverity | "ALL")}
              >
                <option value="ALL">Toutes sévérités</option>
                <option value="high">Critique</option>
                <option value="medium">Important</option>
                <option value="low">Information</option>
              </select>
              <select
                className="border rounded-md px-3 py-2 text-sm bg-card"
                value={status}
                onChange={(event) => setStatus(event.target.value as AlertStatus | "ALL")}
              >
                <option value="active">Actives</option>
                <option value="resolved">Traitées</option>
                <option value="ignored">Ignorées</option>
                <option value="ALL">Tous statuts</option>
              </select>
            </div>
          }
        />
        <div className="p-5 space-y-3">
          {alerts.map((alert) => {
            const meta = severityMeta[alert.severity];
            const Icon = meta.icon;

            return (
              <div key={alert.id} className="border rounded-lg p-4 flex items-start gap-4">
                <div
                  className={`size-10 rounded-md flex items-center justify-center shrink-0 ${meta.color}`}
                >
                  <Icon className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h4 className="font-semibold text-sm">{alert.title}</h4>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <Badge tone={statusTone[alert.status]}>{statusLabel[alert.status]}</Badge>
                    <Badge tone="neutral">{alert.rule}</Badge>
                  </div>
                  <div className="text-sm font-medium">{alert.employee}</div>
                  <p className="text-xs text-muted-foreground mt-1">{alert.detail}</p>
                  <div className="text-xs text-muted-foreground mt-2">
                    Détectée il y a {alert.detectedDays} jour{alert.detectedDays > 1 ? "s" : ""}
                  </div>
                </div>
                {alert.status === "active" && (
                  <div className="flex flex-col gap-2 shrink-0">
                    <Button
                      variant="outline"
                      className="!py-1.5 text-xs"
                      disabled={updateAlertStatus.isPending}
                      onClick={() =>
                        updateAlertStatus.mutate({ id: alert.id, nextStatus: "resolved" })
                      }
                    >
                      <CheckCircle2 className="size-3.5" /> Traiter
                    </Button>
                    <button
                      className="text-xs text-muted-foreground hover:underline disabled:opacity-60"
                      disabled={updateAlertStatus.isPending}
                      onClick={() =>
                        updateAlertStatus.mutate({ id: alert.id, nextStatus: "ignored" })
                      }
                    >
                      Ignorer
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {!alerts.length && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Aucune alerte trouvée pour ce filtre.
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Règles configurées" />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b bg-muted/30">
              <th className="text-left px-5 py-3 font-medium">Règle</th>
              <th className="text-left px-3 py-3 font-medium">Sévérité</th>
              <th className="text-left px-3 py-3 font-medium">Seuil</th>
              <th className="text-left px-3 py-3 font-medium">Statut</th>
              <th className="text-right px-5 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const meta = severityMeta[rule.severity];

              return (
                <tr key={rule.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{rule.rule}</td>
                  <td className="px-3 py-3">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{rule.threshold}</td>
                  <td className="px-3 py-3">
                    <Badge tone={rule.enabled ? "valid" : "neutral"}>
                      {rule.enabled ? "Active" : "Désactivée"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="outline"
                      className="px-3 py-1"
                      disabled={updateRule.isPending}
                      onClick={() => updateRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                    >
                      {rule.enabled ? "Désactiver" : "Activer"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
