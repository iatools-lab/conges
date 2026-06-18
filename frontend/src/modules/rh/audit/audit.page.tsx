import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardHeader, Button, Badge, StatCard } from "@/components/ui-kit";
import { Search, Download, Filter } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: unknown;
  ipAddress?: string | null;
  userId?: string | null;
  user?: {
    nom?: string | null;
    prenom?: string | null;
    email?: string | null;
  } | null;
};

const actionTone: Record<string, "valid" | "rejected" | "pending" | "info" | "neutral"> = {
  APPROVE: "valid",
  CREATE: "valid",
  UPDATE: "pending",
  EXPORT: "info",
  REJECT: "rejected",
  DELETE: "rejected",
  LOGIN: "neutral",
  LOGOUT: "neutral",
};

const FIELD_LABELS = {
  createdAt: "Horodatage",
  user: "Utilisateur",
  action: "Action",
  entity: "Cible",
  detail: "Détail",
  ipAddress: "IP",
};

const ACTION_FILTERS = ["", "CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "APPROVE", "REJECT", "EXPORT"];

function buildUserLabel(row: AuditRow) {
  const nom = row.user?.nom?.trim() ?? "";
  const prenom = row.user?.prenom?.trim() ?? "";
  const full = `${nom} ${prenom}`.trim();
  if (full) return full;
  return row.user?.email?.trim() || row.userId || "system";
}

function buildDetail(metadata: unknown) {
  if (!metadata) return "-";
  if (typeof metadata === "string") return metadata;
  try {
    return JSON.stringify(metadata);
  } catch {
    return "-";
  }
}

export function RhAudit() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");

  useEffect(() => {
    const query = new URLSearchParams();
    query.set("limit", "200");
    if (search.trim()) query.set("search", search.trim());
    if (action) query.set("action", action);

    setLoading(true);
    apiFetch<{ rows: AuditRow[] }>(`/rh/audit?${query.toString()}`)
      .then((res) => setLogs(res.rows))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [search, action]);

  const last24hCount = useMemo(() => {
    const threshold = Date.now() - 24 * 60 * 60 * 1000;
    return logs.filter((row) => new Date(row.createdAt).getTime() >= threshold).length;
  }, [logs]);

  const modificationsCount = useMemo(
    () => logs.filter((row) => ["CREATE", "UPDATE", "DELETE"].includes(row.action)).length,
    [logs],
  );

  return (
    <AppShell title="Audit" subtitle="Traçabilité complète des actions sur le système RH">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Événements (24h)" value={String(last24hCount)} tone="blue" />
        <StatCard label="Utilisateurs actifs" value={String(new Set(logs.map((row) => row.userId).filter(Boolean)).size)} tone="green" />
        <StatCard label="Modifications" value={String(modificationsCount)} tone="orange" />
        <StatCard label="Rétention" value="36" suffix="mois" tone="purple" />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Journal d'audit"
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="size-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  placeholder="Utilisateur, cible…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-8 pr-3 py-2 text-sm border rounded-md bg-card w-56"
                />
              </div>
              <select
                value={action}
                onChange={(event) => setAction(event.target.value)}
                className="border rounded-md px-3 py-2 text-sm bg-card"
              >
                <option value="">Toutes actions</option>
                {ACTION_FILTERS.filter(Boolean).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select className="border rounded-md px-3 py-2 text-sm bg-card">
                <option>7 derniers jours</option>
                <option>30 jours</option>
                <option>90 jours</option>
                <option>12 mois</option>
              </select>
              <Button variant="outline">
                <Filter className="size-4" /> Filtres
              </Button>
              <Button variant="outline">
                <Download className="size-4" /> Export
              </Button>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                <th className="text-left px-5 py-3 font-medium">Horodatage</th>
                <th className="text-left px-3 py-3 font-medium">Utilisateur</th>
                <th className="text-left px-3 py-3 font-medium">Action</th>
                <th className="text-left px-3 py-3 font-medium">Cible</th>
                <th className="text-left px-3 py-3 font-medium">Détail</th>
                <th className="text-left px-3 py-3 font-medium">IP</th>
                <th className="text-right px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="px-5 py-6 text-center text-muted-foreground" colSpan={7}>
                    Chargement...
                  </td>
                </tr>
              )}
              {!loading && logs.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-muted-foreground font-mono text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-3 font-medium">{buildUserLabel(l)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={actionTone[l.action] ?? "neutral"}>{l.action}</Badge>
                  </td>
                  <td className="px-3 py-3">{l.entity}{l.entityId ? ` #${l.entityId}` : ""}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">{buildDetail(l.metadata)}</td>
                  <td className="px-3 py-3 text-muted-foreground font-mono text-xs">{l.ipAddress ?? "-"}</td>
                  <td className="px-5 py-3 text-right">
                    <RowActions
                      label={`l'événement ${l.action}`}
                      item={{
                        ...l,
                        detail: buildDetail(l.metadata),
                        user: buildUserLabel(l),
                      } as Record<string, unknown>}
                      fields={autoFields(
                        {
                          ...l,
                          detail: buildDetail(l.metadata),
                          user: buildUserLabel(l),
                        } as Record<string, unknown>,
                        FIELD_LABELS,
                      )}
                      onSave={() => {}}
                      onRemove={() => {}}
                    />
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-muted-foreground" colSpan={7}>
                    Aucun événement trouvé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t text-xs text-muted-foreground">
          <span>Affichage 1-{logs.length} sur {logs.length}</span>
          <div className="flex gap-1">
            <Button variant="outline">Précédent</Button>
            <Button variant="outline">Suivant</Button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
