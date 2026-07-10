import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { leaveYearForDate } from "@/lib/leave-year";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Coins, FileUp, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

type LiabilityTone = "valid" | "pending" | "rejected" | "neutral";
type UserStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE";

type LiabilityYear = {
  year: number;
  allocated: number;
  consumed: number;
  remaining: number;
};

type LiabilityRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  matricule: string;
  department: string;
  status: UserStatus;
  passifInitial: number;
  y2025: number;
  y2026: number;
  y2027: number;
  consumed: number;
  remaining: number;
  liabilityStatus: LiabilityTone;
  liabilityStatusLabel: string;
  years: LiabilityYear[];
};

type LiabilityResponse = {
  year: number;
  passiveYears: number[];
  rows: LiabilityRow[];
  totals: {
    employees: number;
    employeesWithLiability: number;
    initial: number;
    allocated: number;
    consumed: number;
    remaining: number;
  };
};

type UpdatePayload = {
  employeeId: string;
  passifInitial: number;
};

type ImportRow = {
  employeeId?: string;
  matricule?: string;
  passifInitial: number;
};

type ImportPayload = {
  rows: ImportRow[];
};

type ImportResponse = {
  imported: number;
  rows: LiabilityRow[];
};

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };

const emptyRows: LiabilityRow[] = [];
const emptyTotals: LiabilityResponse["totals"] = {
  employees: 0,
  employeesWithLiability: 0,
  initial: 0,
  allocated: 0,
  consumed: 0,
  remaining: 0,
};

const statusLabel: Record<UserStatus, string> = {
  ACTIVE: "Actif",
  ON_LEAVE: "En congé",
  INACTIVE: "Inactif",
};

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function normalizeHeader(value: ExcelCell) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cellToText(value: ExcelCell) {
  return String(value ?? "").trim();
}

function cellToNumber(value: ExcelCell, rowNumber: number) {
  const numberValue =
    typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Ligne ${rowNumber}: passif initial invalide`);
  }

  return Math.round(numberValue * 10) / 10;
}

function getSheetRows(result: ExcelReadResult) {
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function parseImportRows(result: ExcelReadResult): ImportRow[] {
  const sheetRows = getSheetRows(result).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""),
  );
  if (sheetRows.length < 2) {
    throw new Error("Le fichier doit contenir une ligne d'en-tête et au moins un employé");
  }

  const [headerRow, ...bodyRows] = sheetRows;
  const columns = headerRow.map((header) => {
    const normalized = normalizeHeader(header);
    if (["id", "employeeid", "userid", "identifiant"].includes(normalized)) return "employeeId";
    if (["matricule", "mat", "codeemploye"].includes(normalized)) return "matricule";
    if (["passif", "passifinitial", "passifconges", "passifhistorique"].includes(normalized)) {
      return "passifInitial";
    }
    return "";
  });
  const hasEmployeeKey = columns.includes("employeeId") || columns.includes("matricule");
  const hasPassiveDays = columns.includes("passifInitial");
  if (!hasEmployeeKey || !hasPassiveDays) {
    throw new Error("Colonnes requises: Matricule et Passif initial");
  }

  return bodyRows.map((row, rowIndex) => {
    const values: Partial<ImportRow> = {};
    columns.forEach((column, columnIndex) => {
      if (!column) return;
      if (column === "passifInitial") {
        values.passifInitial = cellToNumber(row[columnIndex], rowIndex + 2);
        return;
      }
      values[column] = cellToText(row[columnIndex]);
    });

    if (!values.employeeId && !values.matricule) {
      throw new Error(`Matricule manquant à la ligne ${rowIndex + 2}`);
    }
    if (values.passifInitial === undefined) {
      throw new Error(`Passif initial manquant à la ligne ${rowIndex + 2}`);
    }

    return values as ImportRow;
  });
}

function LiabilityForm({
  rows,
  defaultEmployeeId = "",
  defaultPassifInitial = 0,
  disabled,
  submitLabel,
  onSubmit,
}: {
  rows: LiabilityRow[];
  defaultEmployeeId?: string;
  defaultPassifInitial?: number;
  disabled: boolean;
  submitLabel: string;
  onSubmit: (payload: UpdatePayload) => Promise<unknown>;
}) {
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [passifInitial, setPassifInitial] = useState(defaultPassifInitial);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit({ employeeId, passifInitial: Number(passifInitial) });
      }}
    >
      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Employé *</span>
        <select
          className={inputClass}
          value={employeeId}
          onChange={(event) => {
            const nextEmployeeId = event.target.value;
            setEmployeeId(nextEmployeeId);
            const selectedRow = rows.find((row) => row.employeeId === nextEmployeeId);
            if (selectedRow) setPassifInitial(selectedRow.passifInitial);
          }}
          disabled={Boolean(defaultEmployeeId)}
          required
        >
          <option value="">Sélectionner un employé</option>
          {rows.map((row) => (
            <option key={row.employeeId} value={row.employeeId}>
              {row.matricule} - {row.employeeName}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Passif initial *</span>
        <input
          type="number"
          max="72"
          step="0.5"
          className={inputClass}
          value={passifInitial}
          onChange={(event) => setPassifInitial(Number(event.target.value || 0))}
          required
        />
      </label>

      <Button type="submit" className="justify-center" disabled={disabled || !employeeId}>
        {submitLabel}
      </Button>
    </form>
  );
}

function LiabilityDialog({
  rows,
  row,
  disabled,
  onSave,
}: {
  rows: LiabilityRow[];
  row?: LiabilityRow;
  disabled: boolean;
  onSave: (payload: UpdatePayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={row ? "outline" : "primary"} className={row ? "px-3 py-1.5" : ""}>
          {row ? <Pencil className="size-4" /> : <Plus className="size-4" />}
          {row ? "Modifier" : "Ajouter manuellement"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{row ? `Modifier ${row.employeeName}` : "Passif manuel"}</DialogTitle>
          <DialogDescription>
            Le passif initial est réparti automatiquement sur 2025, 2026 et 2027.
          </DialogDescription>
        </DialogHeader>
        <LiabilityForm
          key={`${row?.employeeId ?? "new"}-${open}`}
          rows={rows}
          defaultEmployeeId={row?.employeeId}
          defaultPassifInitial={row?.passifInitial}
          disabled={disabled}
          submitLabel={disabled ? "Enregistrement..." : "Enregistrer"}
          onSubmit={async (payload) => {
            await onSave(payload);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function LiabilityCard({
  row,
  rows,
  disabled,
  onSave,
}: {
  row: LiabilityRow;
  rows: LiabilityRow[];
  disabled: boolean;
  onSave: (payload: UpdatePayload) => Promise<unknown>;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{row.employeeName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.matricule} · {row.department} · {statusLabel[row.status]}
          </div>
        </div>
        <Badge tone={row.liabilityStatus}>{row.liabilityStatusLabel}</Badge>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Passif initial</div>
          <div className="mt-1 font-semibold">{formatNumber(row.passifInitial)} jour(s)</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Restant</div>
          <div className="mt-1 font-semibold">{formatNumber(row.remaining)} jour(s)</div>
          <div className="text-xs text-muted-foreground">Consommé {formatNumber(row.consumed)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        {row.years.map((year) => (
          <div key={year.year} className="rounded-md border bg-background px-2 py-2">
            <div className="text-muted-foreground">{year.year}</div>
            <div className="mt-1 font-semibold">{formatNumber(year.allocated)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <LiabilityDialog rows={rows} row={row} disabled={disabled} onSave={onSave} />
      </div>
    </article>
  );
}

export function Passif() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(String(leaveYearForDate()));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | LiabilityTone>("");

  const liabilitiesQuery = useQuery({
    queryKey: ["rh-leave-liabilities", year],
    queryFn: () => apiFetch<LiabilityResponse>(`/rh/leave-liabilities?year=${year}`),
  });

  const rows = liabilitiesQuery.data?.rows ?? emptyRows;
  const totals = liabilitiesQuery.data?.totals ?? emptyTotals;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-leave-liabilities"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-employees"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const updateLiability = useMutation({
    mutationFn: (payload: UpdatePayload) =>
      apiFetch<LiabilityRow>(`/rh/leave-liabilities/${payload.employeeId}`, {
        method: "PATCH",
        body: JSON.stringify({ passifInitial: payload.passifInitial }),
      }),
    onSuccess: () => {
      toast.success("Passif mis à jour");
      refresh();
    },
    onError: (error) => {
      toast.error("Mise à jour impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const importLiabilities = useMutation({
    mutationFn: (payload: ImportPayload) =>
      apiFetch<ImportResponse>("/rh/leave-liabilities/import", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (response) => {
      toast.success(`${response.imported} passif(s) importé(s)`);
      refresh();
    },
    onError: (error) => {
      toast.error("Import impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !query ||
        row.employeeName.toLowerCase().includes(query) ||
        row.matricule.toLowerCase().includes(query) ||
        row.department.toLowerCase().includes(query);
      const matchesStatus = !statusFilter || row.liabilityStatus === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const isMutating = updateLiability.isPending || importLiabilities.isPending;

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const sheet = (await readSheet(file)) as ExcelReadResult;
      const importRows = parseImportRows(sheet);
      await importLiabilities.mutateAsync({ rows: importRows });
    } catch (error) {
      toast.error("Import impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <AppShell title="Gestion du passif">
      <Card className="mb-6 p-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_auto_auto_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Recherche</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
                placeholder="Employé, matricule, pôle..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Statut</span>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "" | LiabilityTone)}
            >
              <option value="">Tous statuts</option>
              <option value="rejected">À apurer</option>
              <option value="pending">En apurement</option>
              <option value="valid">Soldé</option>
              <option value="neutral">Sans passif</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Année</span>
            <input
              className="w-28 rounded-md border bg-background px-3 py-2 text-sm"
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </label>
          <Button variant="outline" onClick={refresh} disabled={liabilitiesQuery.isFetching}>
            <RefreshCw className="size-4" /> Actualiser
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Passif initial"
          value={formatNumber(totals.initial)}
          suffix="jour(s)"
          tone="blue"
        />
        <StatCard
          label="Passif restant"
          value={formatNumber(totals.remaining)}
          suffix="jour(s)"
          tone="orange"
        />
        <StatCard
          label="Consommé"
          value={formatNumber(totals.consumed)}
          suffix="jour(s)"
          tone="green"
        />
        <StatCard label="Employés concernés" value={totals.employeesWithLiability} tone="yellow" />
      </div>

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            variant="outline"
            disabled={isMutating}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" /> Importer
          </Button>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h3 className="font-semibold">Passif régularisé</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Répartition automatique sur 2025, 2026 et 2027, avec suivi du consommé.
            </p>
          </div>
          <LiabilityDialog
            rows={rows}
            disabled={isMutating || liabilitiesQuery.isLoading}
            onSave={(payload) => updateLiability.mutateAsync(payload)}
          />
        </div>

        {liabilitiesQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Chargement du passif...
          </div>
        ) : liabilitiesQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            Impossible de charger le passif.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aucun passif trouvé.
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-4 xl:hidden">
              {filteredRows.map((row) => (
                <LiabilityCard
                  key={row.employeeId}
                  row={row}
                  rows={rows}
                  disabled={isMutating}
                  onSave={(payload) => updateLiability.mutateAsync(payload)}
                />
              ))}
            </div>

            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Passif initial</th>
                    <th className="px-5 py-3">2025</th>
                    <th className="px-5 py-3">2026</th>
                    <th className="px-5 py-3">2027</th>
                    <th className="px-5 py-3">Consommé</th>
                    <th className="px-5 py-3">Restant</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="px-5 py-3">
                        <div className="font-medium">{row.employeeName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.matricule} · {row.department} · {statusLabel[row.status]}
                        </div>
                      </td>
                      <td className="px-5 py-3 font-semibold">{formatNumber(row.passifInitial)}</td>
                      <td className="px-5 py-3">{formatNumber(row.y2025)}</td>
                      <td className="px-5 py-3">{formatNumber(row.y2026)}</td>
                      <td className="px-5 py-3">{formatNumber(row.y2027)}</td>
                      <td className="px-5 py-3">{formatNumber(row.consumed)}</td>
                      <td className="px-5 py-3 font-semibold">{formatNumber(row.remaining)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.liabilityStatus}>{row.liabilityStatusLabel}</Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <LiabilityDialog
                          rows={rows}
                          row={row}
                          disabled={isMutating}
                          onSave={(payload) => updateLiability.mutateAsync(payload)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex items-start gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <Coins className="mt-0.5 size-4 shrink-0" />
          Les mises à jour conservent les consommations déjà enregistrées et recalculent seulement
          les droits passifs annuels.
        </div>
      </Card>
    </AppShell>
  );
}
