import { AppShell } from "@/components/AppShell";
import { Card, Button, Badge } from "@/components/ui-kit";
import { Plus, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

const permissions = [
  { module: "Demandes de congés", emp: true, mgr: true, rh: true, adm: true },
  { module: "Valider demandes", emp: false, mgr: true, rh: true, adm: true },
  { module: "Planning équipe", emp: false, mgr: true, rh: true, adm: true },
  { module: "Vue globale congés", emp: false, mgr: false, rh: true, adm: true },
  { module: "Exports & rapports", emp: false, mgr: false, rh: true, adm: true },
  { module: "Paramètres RH", emp: false, mgr: false, rh: true, adm: true },
  { module: "Gestion utilisateurs", emp: false, mgr: false, rh: false, adm: true },
  { module: "Logs système", emp: false, mgr: false, rh: false, adm: true },
];

export function Roles() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ rows: any[] }>("/admin/roles")
      .then((res) => {
        const c: Record<string, number> = {};
        res.rows.forEach((r) => { c[r.role] = (c[r.role] || 0) + 1; });
        setCounts(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell title="Rôles & permissions" subtitle="Gérez les rôles et leurs autorisations">
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {['Employé','Manager','RH','Admin'].map((name) => (
          <Card key={name} className="p-5">
            <div className="flex items-start justify-between">
              <Shield className={`size-6 text-stat-blue-fg`} />
              <Badge tone="info">{loading ? '…' : counts[name] ?? 0} utilisateurs</Badge>
            </div>
            <div className="mt-3 font-semibold">{name}</div>
            <div className="text-xs text-muted-foreground mt-1">{name === 'Employé' ? 'Soumettre demandes, consulter solde' : name === 'Manager' ? 'Valider demandes équipe, planning' : name === 'RH' ? 'Gestion congés, exports, paramètres' : 'Accès complet système'}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Matrice des permissions</h3>
          <Button>
            <Plus className="size-4" />
            Nouveau rôle
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-5 py-3">Module</th>
              <th className="px-5 py-3 text-center">Employé</th>
              <th className="px-5 py-3 text-center">Manager</th>
              <th className="px-5 py-3 text-center">RH</th>
              <th className="px-5 py-3 text-center">Admin</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {permissions.map((p) => (
              <tr key={p.module}>
                <td className="px-5 py-3 font-medium">{p.module}</td>
                {[p.emp, p.mgr, p.rh, p.adm].map((v, i) => (
                  <td key={i} className="px-5 py-3 text-center">
                    {v ? (
                      <span className="text-stat-green-fg">✓</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
