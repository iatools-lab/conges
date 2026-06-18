import { AppShell } from "@/components/AppShell";
import { Card, Button, Badge } from "@/components/ui-kit";
import { Plus, ArrowRight, Workflow } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

type Flow = { id: string; name: string; steps: string[]; active?: boolean; count?: number };
const FLOW_LABELS = { name: "Nom", steps: "Étapes", active: "Actif", count: "Demandes" };

export function Workflows() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch<{ rows: any[] }>("/admin/workflows")
      .then((res) => {
        if (!mounted) return;
        const mapped = res.rows.map((w) => ({ id: w.id, name: w.name, steps: (w.steps || []).sort((a,b)=>a.order-b.order).map(s=>s.validator || 'Étape'), active: true, count: 0 }));
        setFlows(mapped);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
    return () => { mounted = false; };
  }, []);
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', steps: '' });

  const openCreate = () => { setEditingId(null); setForm({ name: '', steps: '' }); setDlgOpen(true); };
  const openEdit = async (id: string) => {
    try {
      const w = await apiFetch<any>(`/admin/workflows/${id}`);
      setEditingId(id);
      setForm({ name: w.name ?? '', steps: (w.steps || []).sort((a:any,b:any)=>a.order-b.order).map((s:any)=>s.validator||'').join('\n') });
      setDlgOpen(true);
    } catch (err:any) { toast.error(err.message ?? String(err)); }
  };

  const submitForm = async () => {
    const steps = form.steps.split('\n').map((s,i)=>({ validator: s.trim()|| `Étape ${i+1}`, order: i+1 }));
    if (editingId) {
      await apiFetch(`/admin/workflows/${editingId}`, { method: 'PATCH', body: { name: form.name, steps } });
      toast.success('Workflow mis à jour');
    } else {
      await apiFetch(`/admin/workflows`, { method: 'POST', body: { name: form.name, steps } });
      toast.success('Workflow créé');
    }
    setDlgOpen(false);
    const res = await apiFetch<{rows:any[]}>('/admin/workflows');
    const mapped = res.rows.map((w) => ({ id: w.id, name: w.name, steps: (w.steps || []).sort((a:any,b:any)=>a.order-b.order).map((s:any)=>s.validator || 'Étape'), active: true, count: 0 }));
    setFlows(mapped);
  };
  return (
    <AppShell title="Workflows de validation" subtitle="Définir les circuits d'approbation">
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Workflows actifs</div>
          <div className="text-3xl font-bold mt-2">5</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Demandes traitées (mois)</div>
          <div className="text-3xl font-bold mt-2">192</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Délai moyen</div>
          <div className="text-3xl font-bold mt-2">2.3j</div>
        </Card>
      </div>
      <Card>
          <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Workflows configurés</h3>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Créer un workflow
          </Button>
        </div>
        <div className="divide-y">
          {flows.map((f, i) => (
            <div key={f.name} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Workflow className="size-5 text-stat-blue-fg" />
                  <div>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {f.count} demandes traitées ce mois
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={f.active ? "valid" : "neutral"}>
                    {f.active ? "Actif" : "Désactivé"}
                  </Badge>
                  <RowActions
                    label={`le workflow « ${f.name} »`}
                    item={f as unknown as Record<string, unknown>}
                    fields={autoFields(f as unknown as Record<string, unknown>, FLOW_LABELS)}
                    onEdit={() => openEdit(f.id)}
                    onRemove={() => setFlows((rs) => rs.filter((_, j) => j !== i))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {f.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium">{s}</span>
                    {i < f.steps.length - 1 && (
                      <ArrowRight className="size-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Modifier workflow' : 'Créer workflow'}</DialogTitle>
              <DialogDescription>Définir le nom et les étapes (une par ligne).</DialogDescription>
            </DialogHeader>
            <form className="grid gap-3" onSubmit={(e)=>{ e.preventDefault(); submitForm(); }}>
              <div className="grid gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Nom</span>
                  <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Étapes (une par ligne)</span>
                  <textarea rows={6} className="w-full rounded-md border px-3 py-2 text-sm" value={form.steps} onChange={e=>setForm({...form, steps: e.target.value})} />
                </label>
              </div>
              <DialogFooter className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={()=>setDlgOpen(false)}>Annuler</Button>
                <Button type="submit">Enregistrer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
    </AppShell>
  );
}
