import { AppShell } from "@/components/AppShell";
import { Card, Button } from "@/components/ui-kit";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

export function Parametres() {
  const tabs = ["Général", "Congés annuels", "Ancienneté", "Enfants", "Congés spéciaux", "Passif"];
  const [active, setActive] = useState(1);
  const [settings, setSettings] = useState<Record<string,string>>({});

  useEffect(()=>{
    apiFetch<{rows:any[]}>("/admin/settings").then(r=>{
      const map: Record<string,string> = {};
      r.rows.forEach(s=> map[s.key]=s.value);
      setSettings(map);
    }).catch(()=>{});
  },[]);
  return (
    <AppShell title="Paramètres RH">
      <Card>
        <div className="flex border-b px-2">
          {tabs.map((t, i) => (
            <button
              key={t}
              onClick={() => setActive(i)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${active === i ? "border-navy text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-6 p-6">
          <div className="space-y-4">
            <Field label="Congés annuels entreprise" suffix="jours" value={settings['annual_days'] ?? '24'} />
            <Field label="Minimum légal (non modifiable)" suffix="jours" value={settings['min_legal_days'] ?? '18'} />
            <Field label="Acquisition mensuelle" suffix="jours ouvrables" value={settings['monthly_accrual'] ?? '2'} />
            <Field label="Fraction minimale continue" suffix="jours ouvrables" value={settings['min_fraction'] ?? '12'} />
            <div>
              <label className="block text-sm font-medium mb-1.5">Années passif</label>
              <select className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option>2025, 2026, 2027</option>
              </select>
            </div>
            <Button>Enregistrer</Button>
          </div>
          <div className="space-y-3">
            <Alert
              color="blue"
              text="Les paramètres inférieurs au minimum légal ne sont pas autorisés."
            />
            <Alert
              color="orange"
              text="Impossible de définir un congé annuel inférieur à 18 jours."
            />
          </div>
        </div>
      </Card>
    </AppShell>
  );
}

function Field({ label, suffix, value }: { label: string; suffix?: string; value: string }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          defaultValue={value}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function Alert({ color, text }: { color: "blue" | "orange"; text: string }) {
  const cls =
    color === "blue" ? "bg-stat-blue text-stat-blue-fg" : "bg-stat-orange text-stat-orange-fg";
  return (
    <div className={`rounded-md p-4 text-sm flex gap-2 ${cls}`}>
      <AlertCircle className="size-4 mt-0.5 shrink-0" />
      {text}
    </div>
  );
}
