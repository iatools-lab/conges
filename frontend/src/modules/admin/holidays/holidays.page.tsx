import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, Button, Badge } from "@/components/ui-kit";
import { Copy, Plus } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

const FERIES_LABELS = { date: "Date", name: "Nom", country: "Pays", recurring: "Récurent" };

export function Feries() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ rows: any[] }>("/admin/holidays")
      .then((res) => setItems(res.rows))
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleRemove = async (id: string) => {
    if (!confirm("Supprimer ce jour férié ?")) return;
    await apiFetch(`/admin/holidays/${id}`, { method: "DELETE" });
    setItems((s) => s.filter((x) => x.id !== id));
  };

  // create / edit
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ date: '', name: '', country: '', recurring: false });

  const openCreate = () => { setEditingId(null); setForm({ date: '', name: '', country: '', recurring: false }); setDlgOpen(true); };
  const openEdit = async (id: string) => {
    const h = await apiFetch<any>(`/admin/holidays/${id}`);
    setEditingId(id);
    setForm({ date: h.date?.slice(0,10) ?? '', name: h.name ?? '', country: h.country ?? '', recurring: !!h.recurring });
    setDlgOpen(true);
  };

  const submitForm = async () => {
    if (editingId) {
      await apiFetch(`/admin/holidays/${editingId}`, { method: 'PATCH', body: { date: form.date, name: form.name, country: form.country, recurring: form.recurring } });
      toast.success('Jour férié mis à jour');
    } else {
      await apiFetch(`/admin/holidays`, { method: 'POST', body: { date: form.date, name: form.name, country: form.country, recurring: form.recurring } });
      toast.success('Jour férié créé');
    }
    setDlgOpen(false);
    const res = await apiFetch<{rows:any[]}>('/admin/holidays');
    setItems(res.rows);
  };

  return (
    <AppShell title="Jours fériés">
      <Card>
        <div className="flex justify-end gap-2 p-4 border-b">
          <Button variant="outline">
            <Copy className="size-4" />
            Dupliquer l'année précédente
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Ajouter un jour férié
          </Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Nom</th>
              <th className="px-5 py-3">Pays</th>
              <th className="px-5 py-3">Récurrent</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                  Chargement...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-destructive">
                  Erreur: {error}
                </td>
              </tr>
            )}
            {!loading && !error && items.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-3">{new Date(r.date).toLocaleDateString()}</td>
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="px-5 py-3">{r.country}</td>
                <td className="px-5 py-3">{r.recurring ? 'Oui' : 'Non'}</td>
                <td className="px-5 py-3 text-right">
                  <RowActions
                    label={`le jour férié ${r.name}`}
                    item={r as Record<string, unknown>}
                    fields={autoFields(r as Record<string, unknown>, FERIES_LABELS)}
                    onEdit={() => openEdit(r.id)}
                    onRemove={() => handleRemove(r.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Modifier jour férié' : 'Créer jour férié'}</DialogTitle>
              <DialogDescription>Renseignez les détails puis enregistrez.</DialogDescription>
            </DialogHeader>
            <form className="grid gap-3" onSubmit={(e)=>{ e.preventDefault(); submitForm(); }}>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Date</span>
                  <input type="date" className="w-full rounded-md border px-3 py-2 text-sm" value={form.date} onChange={e=>setForm({...form, date: e.target.value})} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Nom</span>
                  <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Pays</span>
                  <input className="w-full rounded-md border px-3 py-2 text-sm" value={form.country} onChange={e=>setForm({...form, country: e.target.value})} />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Récurrent</span>
                  <input type="checkbox" className="mt-2" checked={form.recurring} onChange={e=>setForm({...form, recurring: e.target.checked})} />
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
