import { useState, type ReactNode } from "react";
import { MoreHorizontal, Eye, Pencil, Trash2, type LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui-kit";
import { toast } from "sonner";

export type FieldDef = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select" | "multiselect" | "textarea";
  options?: string[];
  editable?: boolean;
  render?: (value: unknown, item: Record<string, unknown>) => ReactNode;
};

export type RowAction = {
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
};

type Props = {
  label?: string;
  /** Row data — when provided, default Detail/Edit dialogs are wired. */
  item?: Record<string, unknown>;
  /** Field configuration for the Detail + Edit dialogs. */
  fields?: FieldDef[];
  /** Called when Modifier is submitted; receives the updated item. */
  onSave?: (next: Record<string, unknown>) => void;
  /** Called when the user confirms deletion. */
  onRemove?: () => void;
  /** Override default actions entirely. */
  actions?: RowAction[];
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function RowActions({
  label = "cet élément",
  item,
  fields,
  onSave,
  onRemove,
  actions,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const hasAuto = !!item && !!fields;

  const items: RowAction[] = actions ?? [
    {
      label: "Voir détails",
      icon: Eye,
      onSelect:
        onView ?? (hasAuto ? () => setDetailOpen(true) : () => toast.info(`Détails de ${label}`)),
    },
    {
      label: "Modifier",
      icon: Pencil,
      onSelect:
        onEdit ??
        (hasAuto
          ? () => {
              setDraft({ ...item! });
              setEditOpen(true);
            }
          : () => toast.message(`Modification de ${label}`)),
    },
    {
      label: "Supprimer",
      icon: Trash2,
      destructive: true,
      onSelect: onDelete ?? (() => setDelOpen(true)),
    },
  ];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Actions"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {items.map((a, i) => {
            const Icon = a.icon;
            const isLastDestructive = a.destructive && i === items.length - 1;
            return (
              <div key={a.label}>
                {isLastDestructive && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  disabled={a.disabled}
                  onSelect={() => a.onSelect?.()}
                  className={a.destructive ? "text-destructive focus:text-destructive" : ""}
                >
                  {Icon && <Icon className="size-4 mr-2" />}
                  {a.label}
                </DropdownMenuItem>
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Détail */}
      {hasAuto && (
        <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Détail</DialogTitle>
              <DialogDescription>Informations sur {label}.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {fields!.map((f) => {
                const v = (item as Record<string, unknown>)[f.key];
                return (
                  <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <div className="font-medium break-words">
                      {f.render ? f.render(v, item!) : String(v ?? "—")}
                    </div>
                  </div>
                );
              })}
            </dl>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailOpen(false)}>
                Fermer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Modifier */}
      {hasAuto && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>Modifier</DialogTitle>
              <DialogDescription>Ajustez les champs puis enregistrez.</DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                onSave?.(draft);
                setEditOpen(false);
                toast.success(`${label} mis(e) à jour`);
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                {fields!
                  .filter((f) => f.editable !== false)
                  .map((f) => {
                    const value = draft[f.key];
                    const set = (val: unknown) => setDraft((d) => ({ ...d, [f.key]: val }));
                    const common = "w-full rounded-md border px-3 py-2 text-sm bg-background";
                    return (
                      <label
                        key={f.key}
                        className={`grid gap-1.5 text-sm ${f.type === "textarea" ? "col-span-2" : ""}`}
                      >
                        <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
                        {f.type === "select" ? (
                          <select
                            className={common}
                            value={String(value ?? "")}
                            onChange={(e) => set(e.target.value)}
                          >
                            {(f.options ?? []).map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : f.type === "multiselect" ? (
                          <div className={`${common} grid gap-2`}>
                            {(f.options ?? []).map((option) => {
                              const selectedValues = Array.isArray(value)
                                ? value.map((item) => String(item))
                                : [];
                              const checked = selectedValues.includes(option);

                              return (
                                <label key={option} className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...selectedValues, option]
                                        : selectedValues.filter((item) => item !== option);
                                      set(next);
                                    }}
                                  />
                                  <span>{f.render ? f.render(option, draft) : option}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : f.type === "textarea" ? (
                          <textarea
                            rows={3}
                            className={common}
                            value={String(value ?? "")}
                            onChange={(e) => set(e.target.value)}
                          />
                        ) : f.type === "number" ? (
                          <input
                            type="number"
                            className={common}
                            value={Number(value ?? 0)}
                            onChange={(e) => set(Number(e.target.value))}
                          />
                        ) : f.type === "date" ? (
                          <input
                            type="date"
                            className={common}
                            value={String(value ?? "")}
                            onChange={(e) => set(e.target.value)}
                          />
                        ) : (
                          <input
                            className={common}
                            value={String(value ?? "")}
                            onChange={(e) => set(e.target.value)}
                          />
                        )}
                      </label>
                    );
                  })}
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Enregistrer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Supprimer */}
      <AlertDialog open={delOpen} onOpenChange={setDelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ?</AlertDialogTitle>
            <AlertDialogDescription>
              {label} sera définitivement retiré(e) de la liste. Cette action est simulée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (onRemove) onRemove();
                toast.error(`${label} supprimé(e)`);
                setDelOpen(false);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Build a FieldDef[] automatically from an object, with optional label overrides
 * and per-field type/options hints. Keys not in `labels` use the raw key as label.
 */
export function autoFields(
  item: Record<string, unknown>,
  labels: Record<string, string> = {},
  hints: Record<string, Partial<FieldDef>> = {},
): FieldDef[] {
  return Object.keys(item).map((k) => ({
    key: k,
    label: labels[k] ?? k,
    type: hints[k]?.type ?? (typeof item[k] === "number" ? "number" : "text"),
    options: hints[k]?.options,
    editable: hints[k]?.editable,
    render: hints[k]?.render,
  }));
}
