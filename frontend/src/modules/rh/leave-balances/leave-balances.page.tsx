import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import { Download, FileUp, RotateCcw, Search, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };

type ImportRow = {
  matricule: string;
  paidBalance: number;
};

type ImportResultRow = {
  matricule: string;
  employeeId: string;
  employeeName: string;
  acquired: number;
  taken: number;
  scheduled: number;
  previousCarryover: number;
  newCarryover: number;
  importedBalance: number;
  previousRemaining: number;
  newRemaining: number;
};

type ImportResponse = {
  year: number;
  leaveType: { id: string; code: string; name: string };
  imported: number;
  totals: {
    importedBalance: number;
    previousRemaining: number;
    newRemaining: number;
  };
  rows: ImportResultRow[];
};

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const emptyRows: ImportRow[] = [];

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
  const raw = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(raw) || raw < 0) {
    throw new Error(`Solde CP invalide a la ligne ${rowNumber}`);
  }

  return Math.round(raw * 10) / 10;
}

function getSheetRows(result: ExcelReadResult) {
  return Array.isArray(result) ? result : (result.rows ?? []);
}

function parseCsvText(text: string): ExcelCell[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const delimiter = normalized.includes(";") ? ";" : ",";

  return normalized
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) =>
      line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"')),
    );
}

function parseImportRows(result: ExcelReadResult): ImportRow[] {
  const sheetRows = getSheetRows(result).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""),
  );
  if (sheetRows.length < 2) {
    throw new Error("Le fichier doit contenir une ligne d'en-tete et au moins un employe");
  }

  const [headerRow, ...bodyRows] = sheetRows;
  const columns = headerRow.map((header) => {
    const normalized = normalizeHeader(header);
    if (["matricule", "mat", "codeemploye", "codecollaborateur"].includes(normalized)) {
      return "matricule";
    }
    if (
      [
        "soldecp",
        "soldecongepaye",
        "soldecongespayes",
        "congespayes",
        "congepaye",
        "paidbalance",
        "balancecp",
      ].includes(normalized)
    ) {
      return "paidBalance";
    }
    return "";
  });

  if (!columns.includes("matricule") || !columns.includes("paidBalance")) {
    throw new Error("Colonnes requises: Matricule et Solde CP");
  }

  const rows = bodyRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const values: Partial<ImportRow> = {};
    columns.forEach((column, columnIndex) => {
      if (!column) return;
      if (column === "matricule") values.matricule = cellToText(row[columnIndex]);
      if (column === "paidBalance") values.paidBalance = cellToNumber(row[columnIndex], rowNumber);
    });

    if (!values.matricule) throw new Error(`Matricule manquant a la ligne ${rowNumber}`);
    if (values.paidBalance === undefined) {
      throw new Error(`Solde CP manquant a la ligne ${rowNumber}`);
    }

    return values as ImportRow;
  });

  const seen = new Set<string>();
  const duplicate = rows.find((row) => {
    const key = row.matricule.trim().toUpperCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate) {
    throw new Error(`Matricule en double dans le fichier: ${duplicate.matricule}`);
  }

  return rows;
}

function downloadTemplate() {
  const csv = ["Matricule;Solde CP", "EMP001;18", "EMP002;7.5"].join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele-import-soldes-cp.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function RhLeaveBalancesPage() {
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");
  const [previewRows, setPreviewRows] = useState<ImportRow[]>(emptyRows);
  const [lastResult, setLastResult] = useState<ImportResponse | null>(null);

  const importMutation = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      apiFetch<ImportResponse>("/rh/leave-balances/import-paid", {
        method: "POST",
        body: JSON.stringify({
          year: Number(year),
          importedById: session?.id,
          rows,
        }),
      }),
    onSuccess: (response) => {
      setLastResult(response);
      setPreviewRows(emptyRows);
      toast.success(`${response.imported} solde(s) CP importe(s)`);
      void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
    },
    onError: (error) => {
      toast.error("Import impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const previewTotals = useMemo(
    () => ({
      rows: previewRows.length,
      balance: previewRows.reduce((sum, row) => sum + row.paidBalance, 0),
    }),
    [previewRows],
  );

  const filteredPreviewRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return previewRows;
    return previewRows.filter((row) => row.matricule.toLowerCase().includes(query));
  }, [previewRows, search]);

  const resultRows = useMemo(() => lastResult?.rows ?? [], [lastResult?.rows]);
  const filteredResultRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return resultRows;
    return resultRows.filter(
      (row) =>
        row.matricule.toLowerCase().includes(query) ||
        row.employeeName.toLowerCase().includes(query),
    );
  }, [resultRows, search]);

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const sheet = file.name.toLowerCase().endsWith(".csv")
        ? parseCsvText(await file.text())
        : ((await readSheet(file)) as ExcelReadResult);
      const rows = parseImportRows(sheet);
      setPreviewRows(rows);
      setLastResult(null);
      toast.success(`${rows.length} ligne(s) prete(s) a importer`);
    } catch (error) {
      toast.error("Lecture impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  const clearPreview = () => {
    setPreviewRows(emptyRows);
    setLastResult(null);
  };

  const canImport =
    previewRows.length > 0 &&
    Number.isInteger(Number(year)) &&
    Number(year) >= 2000 &&
    Number(year) <= 2100 &&
    !importMutation.isPending;

  return (
    <AppShell title="Import soldes CP">
      <Card className="mb-6 p-5">
        <div className="grid gap-4 lg:grid-cols-[160px_minmax(240px,1fr)] lg:items-end">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Annee</span>
            <input
              type="number"
              min="2000"
              max="2100"
              className={inputClass}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Recherche</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                className={`${inputClass} pl-9`}
                placeholder="Matricule ou nom"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </label>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Lignes en attente" value={previewTotals.rows} tone="blue" />
        <StatCard
          label="Solde CP fichier"
          value={formatNumber(previewTotals.balance)}
          suffix="jour(s)"
          tone="green"
        />
        <StatCard
          label="Dernier import"
          value={lastResult ? lastResult.imported : 0}
          suffix={lastResult ? `${formatNumber(lastResult.totals.newRemaining)} jour(s)` : "Aucun"}
          tone="orange"
        />
      </div>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="size-4" /> Modele
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="size-4" /> Charger
          </Button>
          <Button
            variant="primary"
            disabled={!canImport}
            onClick={() => importMutation.mutate(previewRows)}
          >
            <UploadCloud className="size-4" />
            {importMutation.isPending ? "Import..." : "Importer"}
          </Button>
          <Button
            variant="ghost"
            disabled={!previewRows.length && !lastResult}
            onClick={clearPreview}
          >
            <Trash2 className="size-4" /> Vider
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={handleImportFile}
        />
      </Card>

      <Card className="mt-6 overflow-hidden">
        <CardHeader
          title={previewRows.length ? "Apercu avant import" : "Resultat du dernier import"}
          action={
            <Button
              variant="ghost"
              disabled={!previewRows.length && !lastResult}
              onClick={clearPreview}
            >
              <RotateCcw className="size-4" /> Reinitialiser
            </Button>
          }
        />

        {previewRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Matricule</th>
                  <th className="px-5 py-3 text-right">Solde CP fichier</th>
                  <th className="px-5 py-3 text-left">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredPreviewRows.map((row) => (
                  <tr key={row.matricule}>
                    <td className="px-5 py-3 font-medium">{row.matricule}</td>
                    <td className="px-5 py-3 text-right">{formatNumber(row.paidBalance)}</td>
                    <td className="px-5 py-3">
                      <Badge tone="pending">Pret</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredPreviewRows.length && (
              <div className="px-5 py-8 text-sm text-muted-foreground">
                Aucune ligne ne correspond.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Employe</th>
                  <th className="px-5 py-3 text-left">Matricule</th>
                  <th className="px-5 py-3 text-right">Avant</th>
                  <th className="px-5 py-3 text-right">Importe</th>
                  <th className="px-5 py-3 text-right">Apres</th>
                  <th className="px-5 py-3 text-right">Report ajuste</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredResultRows.map((row) => (
                  <tr key={row.employeeId}>
                    <td className="px-5 py-3 font-medium">{row.employeeName}</td>
                    <td className="px-5 py-3">{row.matricule}</td>
                    <td className="px-5 py-3 text-right">{formatNumber(row.previousRemaining)}</td>
                    <td className="px-5 py-3 text-right">{formatNumber(row.importedBalance)}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {formatNumber(row.newRemaining)}
                    </td>
                    <td className="px-5 py-3 text-right">{formatNumber(row.newCarryover)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredResultRows.length && (
              <div className="px-5 py-8 text-sm text-muted-foreground">
                Aucun import CP charge pour le moment.
              </div>
            )}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
