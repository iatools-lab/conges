import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";

type AuditRow = {
  id: string;
  createdAt: string;
  action: string;
  userId?: string | null;
  ipAddress?: string | null;
  entity?: string;
  entityId?: string | null;
  metadata?: unknown;
};

type Level = "all" | "error" | "warning" | "info";

function levelOf(row: AuditRow): Exclude<Level, "all"> {
  const action = row.action.toLowerCase();
  if (action.includes("error") || action.includes("failed") || action.includes("erreur")) {
    return "error";
  }
  if (action.includes("warning") || action.includes("avertissement")) return "warning";
  return "info";
}

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function Logs() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState<Level>("all");

  useEffect(() => {
    setLoading(true);
    apiFetch<{ rows: AuditRow[] }>("/admin/audit")
      .then((response) => setLogs(response.rows))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter((row) => {
      if (level !== "all" && levelOf(row) !== level) return false;
      if (!query) return true;
      return [row.action, row.userId, row.ipAddress, row.entity, row.entityId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [level, logs, search]);

  const exportRows = () => {
    const lines = [
      ["Horodatage", "Niveau", "Utilisateur", "Action", "Entité", "IP"],
      ...rows.map((row) => [
        row.createdAt,
        levelOf(row),
        row.userId ?? "system",
        row.action,
        row.entity ?? "",
        row.ipAddress ?? "",
      ]),
    ];
    const csv = lines.map((line) => line.map(escapeCsv).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Logs système" subtitle="Journal d'audit applicatif">
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Événements chargés</div>
          <div className="mt-2 text-3xl font-bold">{logs.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Échecs</div>
          <div className="mt-2 text-3xl font-bold text-stat-red-fg">
            {logs.filter((row) => levelOf(row) === "error").length}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Résultats filtrés</div>
          <div className="mt-2 text-3xl font-bold">{rows.length}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher action, utilisateur, IP…"
              className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as Level)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">Tous les niveaux</option>
            <option value="error">Échecs</option>
            <option value="warning">Avertissements</option>
            <option value="info">Informations</option>
          </select>
          <Button variant="outline" onClick={exportRows} disabled={rows.length === 0}>
            <Download className="size-4" /> Exporter
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Horodatage</th>
                <th className="px-5 py-3">Niveau</th>
                <th className="px-5 py-3">Utilisateur</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Chargement…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Aucun événement ne correspond aux filtres.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => {
                  const rowLevel = levelOf(row);
                  return (
                    <tr key={row.id}>
                      <td className="px-5 py-3 font-mono text-xs">
                        {new Date(row.createdAt).toLocaleString("fr-FR")}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          tone={
                            rowLevel === "error"
                              ? "rejected"
                              : rowLevel === "warning"
                                ? "pending"
                                : "info"
                          }
                        >
                          {rowLevel}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{row.userId ?? "system"}</td>
                      <td className="px-5 py-3">{row.action}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        {row.ipAddress ?? "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">
          {rows.length} événement(s) affiché(s)
        </div>
      </Card>
    </AppShell>
  );
}
