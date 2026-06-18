import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui-kit";
import { DEPARTMENTS, EMPLOYEES, LEAVE_TYPES, CURRENT_USER } from "@/lib/departments";
import { CalendarPlus } from "lucide-react";

type Mode = "self" | "team" | "any";

export function PlanForm({ mode = "self", trigger }: { mode?: Mode; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState(CURRENT_USER.department);

  const employees =
    mode === "self"
      ? [CURRENT_USER]
      : mode === "team"
        ? EMPLOYEES.filter((e) => e.department === CURRENT_USER.department)
        : EMPLOYEES.filter((e) => e.department === dept);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <CalendarPlus className="size-4" /> Planifier
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Nouvelle planification de congé</DialogTitle>
          <DialogDescription>
            Renseignez la période et le type de congé. La demande sera enregistrée comme brouillon.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          {mode !== "self" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Département">
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm bg-background"
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  disabled={mode === "team"}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Employé">
                <select className="w-full rounded-md border px-3 py-2 text-sm bg-background">
                  {employees.map((e) => (
                    <option key={e.matricule}>
                      {e.name} — {e.matricule}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {mode === "self" && (
            <Field label="Département">
              <input
                readOnly
                value={DEPARTMENTS.find((d) => d.code === CURRENT_USER.department)?.name ?? ""}
                className="w-full rounded-md border px-3 py-2 text-sm bg-muted/50"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de début">
              <input
                type="date"
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              />
            </Field>
            <Field label="Date de fin">
              <input
                type="date"
                className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type de congé">
              <select className="w-full rounded-md border px-3 py-2 text-sm bg-background">
                {LEAVE_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Remplaçant">
              <select className="w-full rounded-md border px-3 py-2 text-sm bg-background">
                <option value="">— Aucun —</option>
                {EMPLOYEES.filter((e) => e.matricule !== CURRENT_USER.matricule).map((e) => (
                  <option key={e.matricule}>{e.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Commentaire">
            <textarea
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm bg-background"
              placeholder="Précisez le motif ou les informations utiles…"
            />
          </Field>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit">Enregistrer la planification</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
