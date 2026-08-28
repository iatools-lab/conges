import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { readSheet } from "read-excel-file/browser";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { RowActions } from "@/components/RowActions";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, CardHeader, StatCard } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { useAuthSession } from "@/modules/auth/session";
import {
  AlertCircle,
  Ban,
  Download,
  Eye,
  FileUp,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";

type BadgeTone =
  | "valid"
  | "pending"
  | "rejected"
  | "draft"
  | "info"
  | "neutral"
  | "review"
  | "planned";

type DepartmentOption = {
  code: string;
  name: string;
};

type PlanificationRow = {
  id: string;
  reference: string;
  employee: string;
  manager: string;
  departmentCode: string;
  departmentName: string;
  ownerId?: string;
  submittedAt?: string | null;
  submittedDate?: string | null;
  startDate: string;
  endDate: string;
  startDateIso?: string;
  endDateIso?: string;
  days: number;
  type: string;
  leaveTypeCode?: string;
  leaveTypeCategory?: string;
  reason?: string;
  statusCode: string;
  status: BadgeTone;
  label: string;
};

type GlobalViewResponse = {
  year: number;
  departments: DepartmentOption[];
  planifications: PlanificationRow[];
};

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };
type HistoryImportCategory = "pris" | "planifier";

type HistoryImportRow = {
  reference: string;
  matricule: string;
  category: HistoryImportCategory;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
};

type HistoryImportResponse = {
  imported: number;
  importedTaken: number;
  importedPlanned: number;
  skipped: number;
  rows: Array<
    HistoryImportRow & {
      id: string;
      employeeName: string;
      leaveType: string;
      categoryLabel: string;
      statusCode: string;
      statusLabel: string;
    }
  >;
  skippedRows: Array<{ reference: string; matricule: string; reason: string }>;
  totals: { days: number; takenDays: number; plannedDays: number };
};

type ProcessedFilter = "ALL" | "APPROVED" | "REJECTED" | "CANCELLED";
type ProcessedEditDraft = {
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  comment: string;
};

const PROCESSED_PAGE_SIZE = 15;

function buildGlobalViewPath(range: DateRangeValue, department: string) {
  const params = appendDateRange(new URLSearchParams(), range);
  if (department !== "ALL") params.set("department", department);

  return `/rh/global-view?${params.toString()}`;
}

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
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Nombre de jours invalide a la ligne ${rowNumber}`);
  }

  return Math.round(raw * 10) / 10;
}

function cellToCategory(value: ExcelCell, rowNumber: number): HistoryImportCategory {
  const normalized = normalizeHeader(value);

  if (
    [
      "pris",
      "prix",
      "prise",
      "prises",
      "taken",
      "valide",
      "valides",
      "validee",
      "validees",
      "approuve",
      "approuves",
      "approuvee",
      "approuvees",
      "approved",
      "historiquevalide",
      "congevalide",
      "congesvalides",
      "consomme",
      "consommes",
      "congepris",
      "congespris",
    ].includes(normalized)
  ) {
    return "pris";
  }
  if (
    [
      "planifier",
      "planifie",
      "planifies",
      "planifiee",
      "planifiees",
      "planification",
      "planned",
    ].includes(normalized)
  ) {
    return "planifier";
  }

  throw new Error(`Categorie invalide a la ligne ${rowNumber}: utilisez pris ou planifier`);
}

function formatImportCategory(category: HistoryImportCategory) {
  return category === "pris" ? "Pris" : "Planifie";
}

function cellToDate(value: ExcelCell, rowNumber: number, label: string) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value ?? "").trim();
  const frenchDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const parts = frenchDate
    ? {
        year: Number(frenchDate[3]),
        month: Number(frenchDate[2]),
        day: Number(frenchDate[1]),
      }
    : isoDate
      ? {
          year: Number(isoDate[1]),
          month: Number(isoDate[2]),
          day: Number(isoDate[3]),
        }
      : null;

  if (!parts) {
    throw new Error(`${label} invalide a la ligne ${rowNumber}`);
  }

  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const valid =
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day;

  if (Number.isNaN(date.getTime()) || !valid) {
    throw new Error(`${label} invalide a la ligne ${rowNumber}`);
  }

  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
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

function parseHistoryImportRows(result: ExcelReadResult): HistoryImportRow[] {
  const sheetRows = getSheetRows(result).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""),
  );
  if (sheetRows.length < 2) {
    throw new Error("Le fichier doit contenir une ligne d'en-tete et au moins une demande");
  }

  const [headerRow, ...bodyRows] = sheetRows;
  const columns = headerRow.map((header) => {
    const normalized = normalizeHeader(header);
    if (["reference", "ref", "anciennereference"].includes(normalized)) return "reference";
    if (["matricule", "mat", "codeemploye", "codecollaborateur"].includes(normalized)) {
      return "matricule";
    }
    if (["categorie", "category", "statutimport", "nature"].includes(normalized)) {
      return "category";
    }
    if (["type", "typedeconge", "conge"].includes(normalized)) return "type";
    if (["datedebut", "debut", "startdate"].includes(normalized)) return "startDate";
    if (["datefin", "fin", "enddate"].includes(normalized)) return "endDate";
    if (
      ["nombredejours", "nbjours", "jours", "jour", "days", "duree", "dureejours"].includes(
        normalized,
      )
    ) {
      return "days";
    }
    return "";
  });

  const required = ["reference", "matricule", "category", "type", "startDate", "endDate", "days"];
  const missing = required.filter((column) => !columns.includes(column));
  if (missing.length) {
    throw new Error(
      "Colonnes requises: reference, matricule, categorie, type, date debut, date fin, nombre de jours",
    );
  }

  const rows = bodyRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const values: Partial<HistoryImportRow> = {};

    columns.forEach((column, columnIndex) => {
      if (!column) return;
      if (column === "reference") values.reference = cellToText(row[columnIndex]);
      if (column === "matricule") values.matricule = cellToText(row[columnIndex]);
      if (column === "category") values.category = cellToCategory(row[columnIndex], rowNumber);
      if (column === "type") values.type = cellToText(row[columnIndex]);
      if (column === "startDate") {
        values.startDate = cellToDate(row[columnIndex], rowNumber, "Date debut");
      }
      if (column === "endDate") {
        values.endDate = cellToDate(row[columnIndex], rowNumber, "Date fin");
      }
      if (column === "days") values.days = cellToNumber(row[columnIndex], rowNumber);
    });

    if (!values.reference) throw new Error(`Reference manquante a la ligne ${rowNumber}`);
    if (!values.matricule) throw new Error(`Matricule manquant a la ligne ${rowNumber}`);
    if (!values.category) throw new Error(`Categorie manquante a la ligne ${rowNumber}`);
    if (!values.type) throw new Error(`Type de conge manquant a la ligne ${rowNumber}`);
    if (!values.startDate || !values.endDate || values.days === undefined) {
      throw new Error(`Ligne incomplete a la ligne ${rowNumber}`);
    }

    return values as HistoryImportRow;
  });

  const seenReferences = new Set<string>();
  const duplicate = rows.find((row) => {
    const key = row.reference.trim().toUpperCase();
    if (seenReferences.has(key)) return true;
    seenReferences.add(key);
    return false;
  });
  if (duplicate) throw new Error(`Reference en double dans le fichier: ${duplicate.reference}`);

  return rows;
}

function downloadHistoryTemplate() {
  const csv = [
    "reference;matricule;categorie;type;date debut;date fin;nombre de jours",
    "OLD-2025-001;EMP001;valide;paye;2025-04-01;2025-04-05;5",
    "PLAN-2025-001;EMP002;planifier;paye;2025-08-12;2025-08-20;7",
  ].join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele-import-historique-conges.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportRowCsv(row: PlanificationRow) {
  const headers = [
    "Référence",
    "Employé",
    "Département",
    "Début",
    "Fin",
    "Jours",
    "Type",
    "Statut",
  ];
  const values = [
    row.reference,
    row.employee,
    row.departmentName,
    row.startDate,
    row.endDate,
    formatNumber(row.days),
    row.type,
    row.label,
  ];
  const csv = [headers, values]
    .map((line) => line.map((cell) => escapeCsvValue(cell)).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `demande-${row.reference}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function RhDemandesConges() {
  const queryClient = useQueryClient();
  const { session } = useAuthSession();
  const historyFileInputRef = useRef<HTMLInputElement>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [department, setDepartment] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [processedFilter, setProcessedFilter] = useState<ProcessedFilter>("ALL");
  const [query, setQuery] = useState("");
  const [remarkDialog, setRemarkDialog] = useState<PlanificationRow | null>(null);
  const [remark, setRemark] = useState("");
  const [historyPreviewRows, setHistoryPreviewRows] = useState<HistoryImportRow[]>([]);
  const [lastHistoryImport, setLastHistoryImport] = useState<HistoryImportResponse | null>(null);
  const [processedPage, setProcessedPage] = useState(1);
  const [processedDetail, setProcessedDetail] = useState<PlanificationRow | null>(null);
  const [processedEdit, setProcessedEdit] = useState<PlanificationRow | null>(null);
  const [processedEditDraft, setProcessedEditDraft] = useState<ProcessedEditDraft>({
    startDate: "",
    endDate: "",
    days: 1,
    reason: "",
    comment: "",
  });

  const queryKey = ["rh-leave-requests", department, ...dateRangeQueryKey(dateRange)];

  const { data, isError, isFetching, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => apiFetch<GlobalViewResponse>(buildGlobalViewPath(dateRange, department)),
  });

  const invalidateLeaveRequestViews = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["manager-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["manager-planning"] });
    void queryClient.invalidateQueries({ queryKey: ["manager-requests"] });
  };

  const rhDecisionMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${id}/decision`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          decision,
        }),
      });
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "approve" ? "Demande confirmée par RH" : "Demande rejetée par RH",
      );
      invalidateLeaveRequestViews();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Décision RH impossible");
    },
  });

  const rhRemarkMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${id}/remark`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          comment,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Remarque RH enregistrée", {
        description:
          "La remarque sera visible dans le détail de la demande pour le demandeur et le N+1.",
      });
      setRemarkDialog(null);
      setRemark("");
      invalidateLeaveRequestViews();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer la remarque RH",
      );
    },
  });

  const importHistoryMutation = useMutation({
    mutationFn: (rows: HistoryImportRow[]) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch<HistoryImportResponse>("/rh/global-view/requests/import-history", {
        method: "POST",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          rows,
        }),
      });
    },
    onSuccess: (response) => {
      setLastHistoryImport(response);
      setHistoryPreviewRows([]);
      toast.success(`${response.imported} ligne(s) importee(s)`, {
        description: [
          `${response.importedTaken} pris, ${response.importedPlanned} planifie(s).`,
          response.skipped ? `${response.skipped} reference(s) deja existante(s) ignoree(s).` : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
      invalidateLeaveRequestViews();
      void queryClient.invalidateQueries({ queryKey: ["rh-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["employee-history"] });
    },
    onError: (error) => {
      toast.error("Import historique impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const updateProcessedMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProcessedEditDraft }) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${id}/processed`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          startDate: payload.startDate,
          endDate: payload.endDate,
          days: payload.days,
          reason: payload.reason,
          comment: payload.comment,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Demande traitÃ©e mise Ã  jour");
      setProcessedEdit(null);
      invalidateLeaveRequestViews();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Modification impossible");
    },
  });

  const cancelProcessedMutation = useMutation({
    mutationFn: (row: PlanificationRow) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${row.id}/cancel`, {
        method: "PATCH",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          comment: "Annulation depuis l'historique RH",
        }),
      });
    },
    onSuccess: () => {
      toast.success("Demande annulÃ©e et soldes resynchronisÃ©s");
      invalidateLeaveRequestViews();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Annulation impossible");
    },
  });

  const deleteProcessedMutation = useMutation({
    mutationFn: (row: PlanificationRow) => {
      if (!session) throw new Error("Session RH introuvable");
      return apiFetch(`/rh/global-view/requests/${row.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          rhId: session.id,
          rhEmail: session.email,
          comment: "Suppression depuis l'historique RH",
        }),
      });
    },
    onSuccess: () => {
      toast.success("Demande supprimÃ©e et soldes resynchronisÃ©s");
      invalidateLeaveRequestViews();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    },
  });

  const planifications = useMemo(() => data?.planifications ?? [], [data?.planifications]);
  const typeOptions = useMemo(
    () =>
      Array.from(new Set(planifications.map((row) => row.type))).sort((a, b) => a.localeCompare(b)),
    [planifications],
  );

  const searchText = query.trim().toLowerCase();
  const baseFiltered = planifications.filter((row) => {
    if (typeFilter !== "ALL" && row.type !== typeFilter) return false;
    if (!searchText) return true;

    return [row.reference, row.employee, row.departmentName, row.departmentCode]
      .join(" ")
      .toLowerCase()
      .includes(searchText);
  });

  const managerPendingRows = baseFiltered.filter((row) => row.statusCode === "PENDING");
  const rhPendingRows = baseFiltered.filter((row) => row.statusCode === "IN_REVIEW");
  const plannedRows = baseFiltered.filter((row) => row.statusCode === "DRAFT");
  const processedRows = baseFiltered.filter((row) => {
    if (!["APPROVED", "REJECTED", "CANCELLED"].includes(row.statusCode)) return false;
    if (processedFilter === "ALL") return true;
    return row.statusCode === processedFilter;
  });
  const processedTotalPages = Math.max(1, Math.ceil(processedRows.length / PROCESSED_PAGE_SIZE));
  const processedCurrentPage = Math.min(processedPage, processedTotalPages);
  const processedFirstRow =
    processedRows.length === 0 ? 0 : (processedCurrentPage - 1) * PROCESSED_PAGE_SIZE + 1;
  const processedLastRow = Math.min(
    processedCurrentPage * PROCESSED_PAGE_SIZE,
    processedRows.length,
  );
  const paginatedProcessedRows = processedRows.slice(
    (processedCurrentPage - 1) * PROCESSED_PAGE_SIZE,
    processedCurrentPage * PROCESSED_PAGE_SIZE,
  );
  const historyPreviewTotalDays = historyPreviewRows.reduce((sum, row) => sum + row.days, 0);
  const historyPreviewTakenRows = historyPreviewRows.filter((row) => row.category === "pris");
  const historyPreviewPlannedRows = historyPreviewRows.filter(
    (row) => row.category === "planifier",
  );
  const historyPreviewTakenDays = historyPreviewTakenRows.reduce((sum, row) => sum + row.days, 0);
  const historyPreviewPlannedDays = historyPreviewPlannedRows.reduce(
    (sum, row) => sum + row.days,
    0,
  );
  const canImportHistory = historyPreviewRows.length > 0 && !importHistoryMutation.isPending;

  const handleHistoryFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const sheet = file.name.toLowerCase().endsWith(".csv")
        ? parseCsvText(await file.text())
        : ((await readSheet(file)) as ExcelReadResult);
      const rows = parseHistoryImportRows(sheet);
      setHistoryPreviewRows(rows);
      setLastHistoryImport(null);
      const takenCount = rows.filter((row) => row.category === "pris").length;
      const plannedCount = rows.filter((row) => row.category === "planifier").length;
      toast.success(`${rows.length} ligne(s) prete(s) a importer`, {
        description: `${takenCount} pris, ${plannedCount} planifie(s).`,
      });
    } catch (error) {
      toast.error("Lecture impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  const clearHistoryImport = () => {
    setHistoryPreviewRows([]);
    setLastHistoryImport(null);
  };

  const openProcessedEdit = (row: PlanificationRow) => {
    setProcessedEdit(row);
    setProcessedEditDraft({
      startDate: row.startDateIso ?? "",
      endDate: row.endDateIso ?? "",
      days: row.days,
      reason: row.reason ?? "",
      comment: "",
    });
  };

  return (
    <AppShell
      title="Demande et Planification"
      subtitle="Suivi RH des demandes en attente N+1, validations RH et historique traité"
    >
      <div className="mb-3">
        <DateRangeFilter
          value={dateRange}
          onChange={(nextRange) => {
            setDateRange(nextRange);
            setProcessedPage(1);
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setProcessedPage(1);
          }}
        >
          <option value="ALL">Tous départements</option>
          {(data?.departments ?? []).map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value);
            setProcessedPage(1);
          }}
        >
          <option value="ALL">Tous types</option>
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select
          className="rounded-md border px-3 py-2 text-sm bg-background"
          value={processedFilter}
          onChange={(event) => {
            setProcessedFilter(event.target.value as ProcessedFilter);
            setProcessedPage(1);
          }}
        >
          <option value="ALL">Historique: tous statuts</option>
          <option value="APPROVED">Historique: approuvées</option>
          <option value="REJECTED">Historique: rejetées</option>
          <option value="CANCELLED">Historique: annulées</option>
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setProcessedPage(1);
            }}
            placeholder="Rechercher référence, employé..."
            className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Attente action N+1"
          value={isLoading ? "..." : managerPendingRows.length}
          tone="orange"
        />
        <StatCard
          label="Attente validation RH"
          value={isLoading ? "..." : rhPendingRows.length}
          tone="yellow"
        />
        <StatCard
          label="Congés planifiés"
          value={isLoading ? "..." : plannedRows.length}
          tone="blue"
        />
        <StatCard
          label="Total filtré"
          value={isLoading ? "..." : baseFiltered.length}
          tone="blue"
        />
      </div>

      {isError && (
        <Card className="mt-6 p-5 border-destructive/40 bg-destructive/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-sm text-destructive">
              <AlertCircle className="size-5" />
              <span>Impossible de charger les demandes de congés RH.</span>
            </div>
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
              Réessayer
            </Button>
          </div>
        </Card>
      )}

      <Tabs defaultValue="n1" className="mt-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="n1">
            En attente d'action N+1 ({managerPendingRows.length})
          </TabsTrigger>
          <TabsTrigger value="rh">En attente validation RH ({rhPendingRows.length})</TabsTrigger>
          <TabsTrigger value="planned">Congés planifiés ({plannedRows.length})</TabsTrigger>
          <TabsTrigger value="history">Historique traité ({processedRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="n1" className="mt-4">
          <Card>
            <CardHeader
              title="Demandes en attente d'action N+1"
              action={<Badge tone="pending">Niveau N+1</Badge>}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Date de soumission</th>
                    <th className="px-5 py-3">N+1</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Type de congé</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {managerPendingRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.submittedDate ?? "—"}</td>
                      <td className="px-5 py-3">{row.manager}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">
                        {row.startDate} - {row.endDate}
                      </td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRemarkDialog(row);
                              setRemark("");
                            }}
                          >
                            Laisser une remarque
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!managerPendingRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={10}>
                        Aucune demande en attente d'action N+1 pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="rh" className="mt-4">
          <Card>
            <CardHeader title="Demandes en attente de validation RH" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Type de congé</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Date de soumission</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3 text-right">Actions RH</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rhPendingRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">
                        {row.startDate} - {row.endDate}
                      </td>
                      <td className="px-5 py-3">{row.submittedDate ?? "—"}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="success"
                            size="sm"
                            disabled={rhDecisionMutation.isPending}
                            onClick={() =>
                              rhDecisionMutation.mutate({ id: row.id, decision: "approve" })
                            }
                          >
                            Valider
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={rhDecisionMutation.isPending}
                            onClick={() =>
                              rhDecisionMutation.mutate({ id: row.id, decision: "reject" })
                            }
                          >
                            Rejeter
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rhPendingRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={9}>
                        Aucune demande en attente de validation RH pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="planned" className="mt-4">
          <Card>
            <CardHeader title="Tous les congés planifiés de l'entreprise" />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">N+1</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Type de congé</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Date de soumission</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Statut</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {plannedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.manager}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">
                        {row.startDate} - {row.endDate}
                      </td>
                      <td className="px-5 py-3">{row.submittedDate ?? "—"}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/rh/global">Ouvrir</Link>
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => exportRowCsv(row)}>
                            <Download className="size-4" /> Exporter
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!plannedRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={10}>
                        Aucun congé planifié trouvé pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader
              title="Historique des demandes traitées (N+1 + RH)"
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={downloadHistoryTemplate}>
                    <Download className="size-4" /> Modèle
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => historyFileInputRef.current?.click()}
                  >
                    <FileUp className="size-4" /> Charger
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={importHistoryMutation.isPending}
                    onClick={() =>
                      canImportHistory
                        ? importHistoryMutation.mutate(historyPreviewRows)
                        : historyFileInputRef.current?.click()
                    }
                  >
                    <UploadCloud className="size-4" />
                    {importHistoryMutation.isPending
                      ? "Import..."
                      : canImportHistory
                        ? "Importer"
                        : "Choisir un fichier"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!historyPreviewRows.length && !lastHistoryImport}
                    onClick={clearHistoryImport}
                  >
                    <Trash2 className="size-4" /> Vider
                  </Button>
                  <input
                    ref={historyFileInputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleHistoryFileChange}
                  />
                </div>
              }
            />
            {historyPreviewRows.length > 0 && (
              <div className="border-b bg-muted/20 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="pending">{historyPreviewRows.length} ligne(s) prête(s)</Badge>
                  <Badge tone="info">{formatNumber(historyPreviewTotalDays)} jour(s)</Badge>
                  <Badge tone="valid">
                    {historyPreviewTakenRows.length} pris - {formatNumber(historyPreviewTakenDays)}{" "}
                    jour(s)
                  </Badge>
                  <Badge tone="planned">
                    {historyPreviewPlannedRows.length} planifie(s) -{" "}
                    {formatNumber(historyPreviewPlannedDays)} jour(s)
                  </Badge>
                </div>
                <div className="overflow-x-auto rounded-md border bg-background">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="px-4 py-3">Référence</th>
                        <th className="px-4 py-3">Matricule</th>
                        <th className="px-4 py-3">Categorie</th>
                        <th className="px-4 py-3">Type</th>
                        <th className="px-4 py-3">Période</th>
                        <th className="px-4 py-3 text-right">Jours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {historyPreviewRows.slice(0, 8).map((row) => (
                        <tr key={row.reference}>
                          <td className="px-4 py-3 font-medium">{row.reference}</td>
                          <td className="px-4 py-3">{row.matricule}</td>
                          <td className="px-4 py-3">
                            <Badge tone={row.category === "pris" ? "valid" : "planned"}>
                              {formatImportCategory(row.category)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">{row.type}</td>
                          <td className="px-4 py-3">
                            {row.startDate} - {row.endDate}
                          </td>
                          <td className="px-4 py-3 text-right">{formatNumber(row.days)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {historyPreviewRows.length > 8 && (
                    <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                      {historyPreviewRows.length - 8} autre(s) ligne(s) seront aussi importée(s).
                    </div>
                  )}
                </div>
              </div>
            )}
            {lastHistoryImport && !historyPreviewRows.length && (
              <div className="border-b bg-muted/20 px-5 py-3 text-sm text-muted-foreground">
                Dernier import: {lastHistoryImport.imported} ligne(s) (
                {lastHistoryImport.importedTaken} pris, {lastHistoryImport.importedPlanned}{" "}
                planifie(s)), {formatNumber(lastHistoryImport.totals.days)} jour(s) dont{" "}
                {formatNumber(lastHistoryImport.totals.takenDays)} pris et{" "}
                {formatNumber(lastHistoryImport.totals.plannedDays)} planifie(s)
                {lastHistoryImport.skipped
                  ? `, ${lastHistoryImport.skipped} référence(s) ignorée(s)`
                  : ""}
                .
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Employé</th>
                    <th className="px-5 py-3">Département</th>
                    <th className="px-5 py-3">Type de congé</th>
                    <th className="px-5 py-3">Période</th>
                    <th className="px-5 py-3">Date de soumission</th>
                    <th className="px-5 py-3">Jours</th>
                    <th className="px-5 py-3">Statut final</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {paginatedProcessedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{row.reference}</td>
                      <td className="px-5 py-3">{row.employee}</td>
                      <td className="px-5 py-3">{row.departmentName}</td>
                      <td className="px-5 py-3">{row.type}</td>
                      <td className="px-5 py-3">
                        {row.startDate} - {row.endDate}
                      </td>
                      <td className="px-5 py-3">{row.submittedDate ?? "—"}</td>
                      <td className="px-5 py-3">{formatNumber(row.days)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={row.status}>{row.label}</Badge>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end">
                          <RowActions
                            label={`la demande ${row.reference}`}
                            actions={[
                              {
                                label: "Lire",
                                icon: Eye,
                                onSelect: () => setProcessedDetail(row),
                              },
                              {
                                label: "Modifier",
                                icon: Pencil,
                                disabled: updateProcessedMutation.isPending,
                                onSelect: () => openProcessedEdit(row),
                              },
                              {
                                label: "Exporter",
                                icon: Download,
                                onSelect: () => exportRowCsv(row),
                              },
                              {
                                label: "Annuler",
                                icon: Ban,
                                destructive: true,
                                disabled:
                                  row.statusCode === "CANCELLED" ||
                                  cancelProcessedMutation.isPending,
                                onSelect: () => {
                                  if (window.confirm(`Annuler ${row.reference} ?`)) {
                                    cancelProcessedMutation.mutate(row);
                                  }
                                },
                              },
                              {
                                label: "Supprimer",
                                icon: Trash2,
                                destructive: true,
                                disabled: deleteProcessedMutation.isPending,
                                onSelect: () => {
                                  if (
                                    window.confirm(
                                      `Supprimer definitivement ${row.reference} ? Cette action retire la demande et resynchronise le solde.`,
                                    )
                                  ) {
                                    deleteProcessedMutation.mutate(row);
                                  }
                                },
                              },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!processedRows.length && (
                    <tr>
                      <td className="px-5 py-8 text-center text-muted-foreground" colSpan={9}>
                        Aucune demande traitée trouvée pour ces filtres.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {processedRows.length > PROCESSED_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
                <span>
                  {processedFirstRow}-{processedLastRow} sur {processedRows.length} demande(s)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={processedCurrentPage <= 1}
                    onClick={() => setProcessedPage((current) => Math.max(1, current - 1))}
                  >
                    PrÃ©cÃ©dent
                  </Button>
                  <span>
                    Page {processedCurrentPage}/{processedTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={processedCurrentPage >= processedTotalPages}
                    onClick={() =>
                      setProcessedPage((current) => Math.min(processedTotalPages, current + 1))
                    }
                  >
                    Suivant
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!processedDetail} onOpenChange={(open) => !open && setProcessedDetail(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>DÃ©tail de la demande</DialogTitle>
            <DialogDescription>
              Lecture rapide de la demande traitÃ©e et de son statut final.
            </DialogDescription>
          </DialogHeader>
          {processedDetail && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Info label="RÃ©fÃ©rence" value={processedDetail.reference} />
              <Info label="EmployÃ©" value={processedDetail.employee} />
              <Info label="DÃ©partement" value={processedDetail.departmentName} />
              <Info label="Type" value={processedDetail.type} />
              <Info label="DÃ©but" value={processedDetail.startDate} />
              <Info label="Fin" value={processedDetail.endDate} />
              <Info label="Jours" value={formatNumber(processedDetail.days)} />
              <Info label="Statut" value={processedDetail.label} />
              <Info
                label="Commentaire"
                value={processedDetail.reason || "â€”"}
                className="col-span-2"
              />
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcessedDetail(null)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!processedEdit} onOpenChange={(open) => !open && setProcessedEdit(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Modifier une demande traitÃ©e</DialogTitle>
            <DialogDescription>
              Les dates et les jours seront resynchronisÃ©s dans le solde de l'employÃ©.
            </DialogDescription>
          </DialogHeader>
          {processedEdit && (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                updateProcessedMutation.mutate({
                  id: processedEdit.id,
                  payload: processedEditDraft,
                });
              }}
            >
              <div className="text-xs text-muted-foreground">
                Demande {processedEdit.reference} Â· {processedEdit.employee}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Date dÃ©but</span>
                  <input
                    type="date"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={processedEditDraft.startDate}
                    onChange={(event) =>
                      setProcessedEditDraft((draft) => ({
                        ...draft,
                        startDate: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Date fin</span>
                  <input
                    type="date"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={processedEditDraft.endDate}
                    onChange={(event) =>
                      setProcessedEditDraft((draft) => ({
                        ...draft,
                        endDate: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Jours</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={processedEditDraft.days}
                    onChange={(event) =>
                      setProcessedEditDraft((draft) => ({
                        ...draft,
                        days: Number(event.target.value),
                      }))
                    }
                    required
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">Motif RH</span>
                  <input
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Ex: correction dates"
                    value={processedEditDraft.comment}
                    onChange={(event) =>
                      setProcessedEditDraft((draft) => ({
                        ...draft,
                        comment: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="col-span-2 grid gap-1.5 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">
                    Commentaire de la demande
                  </span>
                  <textarea
                    rows={3}
                    className="rounded-md border bg-background px-3 py-2 text-sm"
                    value={processedEditDraft.reason}
                    onChange={(event) =>
                      setProcessedEditDraft((draft) => ({
                        ...draft,
                        reason: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setProcessedEdit(null)}
                  disabled={updateProcessedMutation.isPending}
                >
                  Annuler
                </Button>
                <Button
                  type="submit"
                  disabled={
                    updateProcessedMutation.isPending ||
                    !processedEditDraft.startDate ||
                    !processedEditDraft.endDate ||
                    processedEditDraft.days <= 0
                  }
                >
                  {updateProcessedMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!remarkDialog} onOpenChange={(open) => !open && setRemarkDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajouter une remarque RH</DialogTitle>
            <DialogDescription>
              Cette remarque sera visible dans le détail de la demande pour le demandeur et le N+1.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              {remarkDialog ? `Demande ${remarkDialog.reference} · ${remarkDialog.employee}` : ""}
            </div>
            <textarea
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Ex: Merci de compléter le motif ou de vérifier les dates avant validation N+1."
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRemarkDialog(null);
                setRemark("");
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!remarkDialog) return;
                rhRemarkMutation.mutate({ id: remarkDialog.id, comment: remark.trim() });
              }}
              disabled={!remark.trim() || rhRemarkMutation.isPending}
            >
              Enregistrer la remarque
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Info({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value}</div>
    </div>
  );
}
