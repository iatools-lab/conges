import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, Badge, Button } from "@/components/ui-kit";
import { Download, Search, Filter } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";

const tone = (l: string) => (l === "error" ? "rejected" : l === "warning" ? "pending" : "info");

const FIELD_LABELS = {
  createdAt: "Horodatage",
  action: "Action",
  userId: "Utilisateur",
  ipAddress: "IP",
};

export function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ rows: any[] }>("/admin/audit")
      .then((res) => setLogs(res.rows))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="Logs système" subtitle="Journal technique et événements système">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Événements (24h)</div>
          <div className="text-3xl font-bold mt-2">{logs.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Erreurs</div>
          <div className="text-3xl font-bold mt-2 text-stat-red-fg">{logs.filter(l => l.action?.toLowerCase?.().includes('error') || l.action?.toLowerCase?.().includes('erreur')).length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Avertissements</div>
          <div className="text-3xl font-bold mt-2 text-stat-orange-fg">{logs.filter(l => l.action?.toLowerCase?.().includes('warning') || l.action?.toLowerCase?.().includes('avertissement')).length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Disponibilité</div>
          <div className="text-3xl font-bold mt-2 text-stat-green-fg">99.8%</div>
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4 border-b">
          <div className="flex-1 min-w-[240px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input placeholder="Rechercher action, utilisateur, IP…" className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm" />
          </div>
          <select className="rounded-md border bg-background px-3 py-2 text-sm">
            <option>Tous les niveaux</option>
            <option>Erreur</option>
            <option>Avertissement</option>
            <option>Info</option>
          </select>
          <Button variant="outline">
            <Filter className="size-4" />
            Filtres
          </Button>
          <Button variant="outline">
            <Download className="size-4" />
            Exporter
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-5 py-3">Horodatage</th>
              <th className="px-5 py-3">Niveau</th>
              <th className="px-5 py-3">Utilisateur</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">IP</th>
              <th className="px-5 py-3 text-right">—</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">Chargement...</td>
              </tr>
            )}
            {!loading && logs.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="px-5 py-3 font-mono text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="px-5 py-3"><Badge tone={tone(l.action?.toLowerCase?.().includes('error') ? 'rejected' : l.action?.toLowerCase?.().includes('warning') ? 'pending' : 'info')}>{l.action?.split?.(' ')?.[0] ?? 'info'}</Badge></td>
                <td className="px-5 py-3 text-muted-foreground">{l.userId ?? l.user ?? 'system'}</td>
                <td className="px-5 py-3">{l.action ?? JSON.stringify(l.metadata)}</td>
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{l.ipAddress ?? '—'}</td>
                <td className="px-5 py-3 text-right">
                  <RowActions label={`l'événement ${l.id ?? i}`} item={l as Record<string, unknown>} fields={autoFields(l as Record<string, unknown>, FIELD_LABELS)} onSave={() => {}} onRemove={() => {}} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between items-center p-4 border-t text-sm text-muted-foreground">
          <span>Affichage 1-{logs.length} sur {logs.length}</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={`size-8 rounded ${n === 1 ? "bg-navy text-navy-foreground" : "hover:bg-accent"}`}>{n}</button>
            ))}
            <button className="size-8 rounded hover:bg-accent">›</button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
