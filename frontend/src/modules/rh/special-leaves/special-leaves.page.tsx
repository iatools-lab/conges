import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import { AppShell } from "@/components/AppShell";
import { RowActions } from "@/components/RowActions";
import {
  DateRangeFilter,
  appendDateRange,
  currentYearRange,
  dateRangeQueryKey,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Badge, Button, Card, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileSearch,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type BadgeTone = "valid" | "pending" | "rejected" | "draft" | "neutral";
type SpecialLeaveStatusCode =
  | "DRAFT"
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";
type EmployeeStatus = "active" | "leave" | "inactive";
type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };

type RhEmployee = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  dept: string;
  status: EmployeeStatus;
};

type SpecialLeaveRow = {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  matricule: string;
  department: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  eventLabel: string;
  startDate: string;
  endDate: string;
  days: number;
  proof: boolean;
  proofLabel: string;
  proofUrl?: string | null;
  status: BadgeTone;
  statusCode: SpecialLeaveStatusCode;
  statusLabel: string;
  quotaTotal: number;
  quotaUsed: number;
  quotaRemaining: number;
  reason: string;
  rhComment?: string;
};

type SpecialLeavesResponse = {
  year: number;
  rows: SpecialLeaveRow[];
  totals: {
    total: number;
    approved: number;
    pending: number;
    days: number;
  };
};

type SpecialLeavePayload = {
  employeeId: string;
  eventLabel: string;
  startDate: string;
  reason: string;
  status: SpecialLeaveStatusCode;
  proofUrl: string;
};

type SpecialLeaveImportRow = {
  matricule: string;
  eventLabel: string;
  eventDate?: string | null;
  startDate?: string | null;
  status?: SpecialLeaveStatusCode;
  reason?: string;
  proofUrl?: string;
  proofFilename?: string;
};

type SpecialLeaveImportResultRow = SpecialLeaveImportRow & {
  rowNumber: number;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  eventDate: string | null;
  startDate: string | null;
  endDate: string | null;
  days: number;
  status: SpecialLeaveStatusCode;
  imported: boolean;
  skippedReason?: string;
};

type SpecialLeaveImportResponse = {
  imported: number;
  skipped: number;
  rows: SpecialLeaveImportResultRow[];
};

const emptyRows: SpecialLeaveRow[] = [];
const emptyImportRows: SpecialLeaveImportRow[] = [];
const emptyEmployees: RhEmployee[] = [];
const emptyTotals: SpecialLeavesResponse["totals"] = {
  total: 0,
  approved: 0,
  pending: 0,
  days: 0,
};

const eventOptions = [
  "Mariage du travailleur",
  "Congé paternité",
  "Baptême d'un enfant du travailleur",
  "Mariage d'un enfant du travailleur",
  "Décès du conjoint du travailleur",
  "Décès d'un enfant du travailleur",
  "Décès du père ou de la mère du travailleur",
  "Décès du père ou de la mère du conjoint légitime",
  "Décès du frère ou de la sœur du travailleur",
];

const statusOptions: { value: SpecialLeaveStatusCode; label: string }[] = [
  { value: "PENDING", label: "À confirmer" },
  { value: "IN_REVIEW", label: "En revue" },
  { value: "APPROVED", label: "Validé" },
  { value: "REJECTED", label: "Refusé" },
  { value: "CANCELLED", label: "Annulé" },
];

const emptyDraft: SpecialLeavePayload = {
  employeeId: "",
  eventLabel: "Mariage du travailleur",
  startDate: "",
  reason: "",
  status: "APPROVED",
  proofUrl: "",
};

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function specialLeavesPath(range: DateRangeValue) {
  const params = appendDateRange(new URLSearchParams(), range);
  const query = params.toString();
  return `/rh/special-leaves${query ? `?${query}` : ""}`;
}

function formatEmployeeLabel(employee: RhEmployee) {
  return `${employee.matricule} - ${employee.prenom} ${employee.nom}`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(`${value}T00:00:00.000Z`));
}

function normalizePayload(payload: SpecialLeavePayload): SpecialLeavePayload {
  return {
    ...payload,
    eventLabel: payload.eventLabel.trim(),
    reason: payload.reason.trim(),
    proofUrl: payload.proofUrl.trim(),
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function isImageProof(url: string) {
  return url.startsWith("data:image/") || /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url);
}

function ProofPreview({ url, title }: { url?: string | null; title: string }) {
  if (!url) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Aucun justificatif joint.
      </div>
    );
  }

  if (isImageProof(url)) {
    return (
      <div className="flex max-h-[65vh] justify-center overflow-auto rounded-md border bg-muted/20 p-2">
        <img src={url} alt={title} className="max-h-[62vh] max-w-full object-contain" />
      </div>
    );
  }

  return (
    <iframe src={url} title={title} className="h-[65vh] w-full rounded-md border bg-background" />
  );
}

function EventDetailsDialog({
  row,
  open,
  onOpenChange,
}: {
  row: SpecialLeaveRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Détail de l'événement</DialogTitle>
          <DialogDescription>{row.reference}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <Detail label="Employé" value={`${row.employeeName} (${row.matricule})`} />
          <Detail label="Département" value={row.department} />
          <Detail label="Événement" value={row.eventLabel} />
          <Detail label="Date" value={formatDate(row.startDate)} />
          <Detail label="Statut" value={row.statusLabel} />
          <Detail label="Justificatif" value={row.proofLabel} />
          <Detail label="Description de l'employé" value={row.reason || "—"} wide />
          <Detail label="Commentaire RH" value={row.rhComment || "—"} wide />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Justificatif</div>
          <ProofPreview url={row.proofUrl} title={`Justificatif ${row.reference}`} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProofDialog({
  row,
  open,
  onOpenChange,
}: {
  row: SpecialLeaveRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Justificatif · {row.reference}</DialogTitle>
          <DialogDescription>Aperçu du document transmis par {row.employeeName}.</DialogDescription>
        </DialogHeader>
        <ProofPreview url={row.proofUrl} title={`Justificatif ${row.reference}`} />
      </DialogContent>
    </Dialog>
  );
}

function EventDecisionDialog({
  row,
  status,
  open,
  disabled,
  onOpenChange,
  onConfirm,
}: {
  row: SpecialLeaveRow;
  status: "IN_REVIEW" | "REJECTED" | "APPROVED";
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment: string) => Promise<unknown>;
}) {
  const [comment, setComment] = useState("");
  const commentRequired = status !== "APPROVED";
  const title =
    status === "IN_REVIEW"
      ? "Mettre l'événement en revue"
      : status === "REJECTED"
        ? "Refuser l'événement"
        : "Valider l'événement";

  const submit = async () => {
    if (commentRequired && !comment.trim()) return;
    try {
      await onConfirm(comment.trim());
      setComment("");
      onOpenChange(false);
    } catch (error) {
      toast.error("Décision impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setComment("");
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {row.eventLabel} déclaré par {row.employeeName}. Le commentaire sera visible par
            l'employé.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            Commentaire RH {commentRequired ? "*" : "(optionnel)"}
          </span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            maxLength={1000}
            className={`${inputClass} resize-y`}
            required={commentRequired}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            variant={status === "REJECTED" ? "danger" : "primary"}
            disabled={disabled || (commentRequired && !comment.trim())}
            onClick={() => void submit()}
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-md border bg-muted/25 p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap font-medium">{value}</div>
    </div>
  );
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

function cellToDateInput(value: ExcelCell, rowNumber: number, label: string) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = cellToText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const frenchDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frenchDate) {
    const [, day, month, year] = frenchDate;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }

  throw new Error(`${label} invalide a la ligne ${rowNumber}`);
}

function parseImportStatus(
  value: ExcelCell,
  rowNumber: number,
): SpecialLeaveStatusCode | undefined {
  const token = normalizeHeader(value);
  if (!token) return undefined;
  if (["approved", "valide", "validee", "valides"].includes(token)) return "APPROVED";
  if (["pending", "aconfirmer", "attente", "avalider"].includes(token)) return "PENDING";
  if (["review", "inreview", "enrevue"].includes(token)) return "IN_REVIEW";
  if (["rejected", "refuse", "refusee"].includes(token)) return "REJECTED";
  if (["cancelled", "canceled", "annule", "annulee"].includes(token)) return "CANCELLED";
  throw new Error(`Statut invalide a la ligne ${rowNumber}`);
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

function parseImportRows(result: ExcelReadResult): SpecialLeaveImportRow[] {
  const sheetRows = getSheetRows(result).filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""),
  );
  if (sheetRows.length < 2) {
    throw new Error("Le fichier doit contenir une ligne d'en-tete et au moins une ligne.");
  }

  const [headerRow, ...bodyRows] = sheetRows;
  const columns = headerRow.map((header) => {
    const normalized = normalizeHeader(header);
    if (["matricule", "mat", "codeemploye", "codecollaborateur"].includes(normalized)) {
      return "matricule";
    }
    if (["evenement", "event", "typeevenement", "type"].includes(normalized)) {
      return "eventLabel";
    }
    if (["dateevenement", "dateevent"].includes(normalized)) return "eventDate";
    if (["datedebut", "debut", "startdate"].includes(normalized)) return "startDate";
    if (["statut", "status"].includes(normalized)) return "status";
    if (["motif", "raison", "commentaire", "reason"].includes(normalized)) return "reason";
    if (["lienjustificatif", "justificatif", "proofurl"].includes(normalized)) return "proofUrl";
    if (["nomfichierjustificatif", "nomjustificatif", "prooffilename"].includes(normalized)) {
      return "proofFilename";
    }
    return "";
  });

  if (!columns.includes("matricule") || !columns.includes("eventLabel")) {
    throw new Error("Colonnes requises: Matricule et Evenement");
  }

  const rows = bodyRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const values: Partial<SpecialLeaveImportRow> = {};

    columns.forEach((column, columnIndex) => {
      if (!column) return;
      if (column === "matricule") values.matricule = cellToText(row[columnIndex]);
      if (column === "eventLabel") values.eventLabel = cellToText(row[columnIndex]);
      if (column === "eventDate" && cellToText(row[columnIndex])) {
        values.eventDate = cellToDateInput(row[columnIndex], rowNumber, "Date evenement");
      }
      if (column === "startDate" && cellToText(row[columnIndex])) {
        values.startDate = cellToDateInput(row[columnIndex], rowNumber, "Date debut");
      }
      if (column === "status") values.status = parseImportStatus(row[columnIndex], rowNumber);
      if (column === "reason") values.reason = cellToText(row[columnIndex]) || undefined;
      if (column === "proofUrl") values.proofUrl = cellToText(row[columnIndex]) || undefined;
      if (column === "proofFilename") {
        values.proofFilename = cellToText(row[columnIndex]) || undefined;
      }
    });

    if (!values.matricule) throw new Error(`Matricule manquant a la ligne ${rowNumber}`);
    if (!values.eventLabel) throw new Error(`Evenement manquant a la ligne ${rowNumber}`);

    return values as SpecialLeaveImportRow;
  });

  const seen = new Set<string>();
  const duplicate = rows.find((row) => {
    const key = `${row.matricule.trim().toUpperCase()}:${row.eventLabel.trim().toLowerCase()}:${row.eventDate ?? "NULL_EVENT_DATE"}:${row.startDate ?? "NULL_START_DATE"}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (duplicate) {
    throw new Error(
      `Ligne en double dans le fichier: ${duplicate.matricule} / ${duplicate.eventLabel} / ${duplicate.eventDate ?? "Date evenement vide"} / ${duplicate.startDate ?? "Date debut vide"}`,
    );
  }

  return rows;
}

function downloadImportTemplate() {
  const csv = [
    "Matricule;Evenement;Date evenement;Date debut;Statut;Motif;Lien justificatif",
    "EMP001;Mariage;2026-07-10;2026-07-10;APPROVED;Mariage civil;https://...",
    "EMP002;Naissance;;2026-08-05;PENDING;Date evenement optionnelle;",
    "EMP003;Deces;2026-09-02;;PENDING;Date debut optionnelle;",
  ].join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modele-import-conges-speciaux.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function SpecialLeaveForm({
  draft,
  employees,
  disabled,
  submitLabel,
  onCancel,
  onSubmit,
  setDraft,
}: {
  draft: SpecialLeavePayload;
  employees: RhEmployee[];
  disabled: boolean;
  submitLabel: string;
  onCancel?: () => void;
  onSubmit: () => void;
  setDraft: Dispatch<SetStateAction<SpecialLeavePayload>>;
}) {
  const set = <K extends keyof SpecialLeavePayload>(key: K, value: SpecialLeavePayload[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Employé *</span>
          <select
            className={inputClass}
            value={draft.employeeId}
            onChange={(event) => set("employeeId", event.target.value)}
            required
          >
            <option value="">Sélectionner un employé</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {formatEmployeeLabel(employee)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Événement *</span>
          <select
            className={inputClass}
            value={draft.eventLabel}
            onChange={(event) => set("eventLabel", event.target.value)}
            required
          >
            {eventOptions.map((eventOption) => (
              <option key={eventOption} value={eventOption}>
                {eventOption}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Statut *</span>
          <select
            className={inputClass}
            value={draft.status}
            onChange={(event) => set("status", event.target.value as SpecialLeaveStatusCode)}
            required
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Début *</span>
          <input
            type="date"
            className={inputClass}
            value={draft.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            required
          />
        </label>

        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          La date de fin et le nombre de jours seront calcules automatiquement selon l'evenement et
          le sexe de l'employe.
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Lien justificatif</span>
          <input
            className={inputClass}
            value={draft.proofUrl}
            onChange={(event) => set("proofUrl", event.target.value)}
            placeholder="https://..."
          />
        </label>

        <label className="grid gap-1.5 text-sm md:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Motif / commentaire RH</span>
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={draft.reason}
            onChange={(event) => set("reason", event.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-2 sm:flex sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" className="justify-center" onClick={onCancel}>
            Annuler
          </Button>
        )}
        <Button type="submit" className="justify-center" disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function NewSpecialLeaveDialog({
  employees,
  disabled,
  onCreate,
}: {
  employees: RhEmployee[];
  disabled: boolean;
  onCreate: (payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SpecialLeavePayload>(emptyDraft);

  const submit = async () => {
    try {
      await onCreate(normalizePayload(draft));
      setOpen(false);
      setDraft(emptyDraft);
    } catch (error) {
      toast.error("Création impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setDraft(emptyDraft);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled || !employees.length}>
          <Plus className="size-4" /> Nouvelle demande
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Nouveau congé spécial</DialogTitle>
          <DialogDescription>
            Enregistrez la demande spéciale et son impact sur le quota annuel séparé.
          </DialogDescription>
        </DialogHeader>
        <SpecialLeaveForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel={disabled ? "Création..." : "Créer"}
          setDraft={setDraft}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditSpecialLeaveDialog({
  row,
  employees,
  disabled,
  open,
  onOpenChange,
  onSave,
}: {
  row: SpecialLeaveRow;
  employees: RhEmployee[];
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<SpecialLeavePayload>({
    employeeId: row.employeeId,
    eventLabel: row.eventLabel,
    startDate: row.startDate,
    reason: row.reason,
    status: row.statusCode,
    proofUrl: "",
  });

  const resetDraft = () =>
    setDraft({
      employeeId: row.employeeId,
      eventLabel: row.eventLabel,
      startDate: row.startDate,
      reason: row.reason,
      status: row.statusCode,
      proofUrl: "",
    });

  const submit = async () => {
    try {
      await onSave(row.id, normalizePayload(draft));
      onOpenChange(false);
    } catch (error) {
      toast.error("Modification impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (nextOpen) resetDraft();
      }}
    >
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Modifier {row.reference}</DialogTitle>
          <DialogDescription>
            Ajustez le statut, la période ou le justificatif de cette demande spéciale.
          </DialogDescription>
        </DialogHeader>
        <SpecialLeaveForm
          draft={draft}
          employees={employees}
          disabled={disabled}
          submitLabel="Enregistrer"
          setDraft={setDraft}
          onCancel={() => onOpenChange(false)}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

function SpecialLeaveActions({
  row,
  employees,
  disabled,
  onCancel,
  onDecideEvent,
  onSave,
}: {
  row: SpecialLeaveRow;
  employees: RhEmployee[];
  disabled: boolean;
  onCancel: (row: SpecialLeaveRow) => void;
  onDecideEvent: (
    row: SpecialLeaveRow,
    status: "IN_REVIEW" | "REJECTED" | "APPROVED",
    comment: string,
  ) => Promise<unknown>;
  onSave: (id: string, payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState<
    "IN_REVIEW" | "REJECTED" | "APPROVED" | null
  >(null);
  const isEventRow = row.leaveTypeCode === "EVT";

  return (
    <>
      <RowActions
        actions={
          isEventRow
            ? [
                {
                  label: "Voir le détail",
                  icon: Eye,
                  onSelect: () => setDetailOpen(true),
                },
                {
                  label: "Voir le justificatif",
                  icon: FileSearch,
                  disabled: !row.proofUrl,
                  onSelect: () => setProofOpen(true),
                },
                {
                  label: "Mettre en revue",
                  icon: Clock3,
                  disabled:
                    disabled || row.statusCode === "IN_REVIEW" || row.statusCode === "APPROVED",
                  onSelect: () => setDecisionStatus("IN_REVIEW"),
                },
                {
                  label: "Refuser",
                  icon: XCircle,
                  destructive: true,
                  disabled:
                    disabled || row.statusCode === "REJECTED" || row.statusCode === "APPROVED",
                  onSelect: () => setDecisionStatus("REJECTED"),
                },
                {
                  label: "Valider",
                  icon: CheckCircle2,
                  disabled: disabled || row.statusCode === "APPROVED",
                  onSelect: () => setDecisionStatus("APPROVED"),
                },
              ]
            : [
                {
                  label: "Modifier",
                  icon: Pencil,
                  disabled,
                  onSelect: () => setEditOpen(true),
                },
                {
                  label: "Annuler",
                  icon: XCircle,
                  destructive: true,
                  disabled: disabled || row.statusCode === "CANCELLED",
                  onSelect: () => onCancel(row),
                },
              ]
        }
      />
      {!isEventRow && (
        <EditSpecialLeaveDialog
          row={row}
          employees={employees}
          disabled={disabled}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={onSave}
        />
      )}
      {isEventRow && (
        <>
          <EventDetailsDialog row={row} open={detailOpen} onOpenChange={setDetailOpen} />
          <ProofDialog row={row} open={proofOpen} onOpenChange={setProofOpen} />
          {decisionStatus && (
            <EventDecisionDialog
              row={row}
              status={decisionStatus}
              open
              disabled={disabled}
              onOpenChange={(open) => !open && setDecisionStatus(null)}
              onConfirm={(comment) => onDecideEvent(row, decisionStatus, comment)}
            />
          )}
        </>
      )}
    </>
  );
}

function SpecialLeaveCard({
  row,
  employees,
  disabled,
  onCancel,
  onDecideEvent,
  onSave,
}: {
  row: SpecialLeaveRow;
  employees: RhEmployee[];
  disabled: boolean;
  onCancel: (row: SpecialLeaveRow) => void;
  onDecideEvent: (
    row: SpecialLeaveRow,
    status: "IN_REVIEW" | "REJECTED" | "APPROVED",
    comment: string,
  ) => Promise<unknown>;
  onSave: (id: string, payload: SpecialLeavePayload) => Promise<unknown>;
}) {
  return (
    <article className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{row.employeeName}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.matricule} · {row.department}
          </div>
        </div>
        <Badge tone={row.status}>{row.statusLabel}</Badge>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Événement</div>
          <div className="mt-1 font-medium">{row.eventLabel}</div>
          <div className="text-xs text-muted-foreground">{row.reference}</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Période</div>
          <div className="mt-1 font-medium">
            {formatDate(row.startDate)} - {formatDate(row.endDate)}
          </div>
          <div className="text-xs text-muted-foreground">{row.days} jour(s)</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Justificatif</div>
          <div className="mt-1 font-medium">{row.proofLabel}</div>
        </div>
        <div className="rounded-md bg-muted/45 px-3 py-2">
          <div className="text-xs text-muted-foreground">Quota restant</div>
          <div className="mt-1 font-semibold">{row.quotaRemaining} jour(s)</div>
          <div className="text-xs text-muted-foreground">sur {row.quotaTotal} jour(s)</div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <SpecialLeaveActions
          row={row}
          employees={employees}
          disabled={disabled}
          onCancel={onCancel}
          onDecideEvent={onDecideEvent}
          onSave={onSave}
        />
      </div>
    </article>
  );
}

export function Speciaux() {
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => currentYearRange());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | SpecialLeaveStatusCode>("");
  const [cancelTarget, setCancelTarget] = useState<SpecialLeaveRow | null>(null);
  const [importRows, setImportRows] = useState<SpecialLeaveImportRow[]>(emptyImportRows);
  const [lastImport, setLastImport] = useState<SpecialLeaveImportResponse | null>(null);

  const specialLeavesQuery = useQuery({
    queryKey: ["rh-special-leaves", ...dateRangeQueryKey(dateRange)],
    queryFn: () => apiFetch<SpecialLeavesResponse>(specialLeavesPath(dateRange)),
  });

  const employeesQuery = useQuery({
    queryKey: ["rh-employees"],
    queryFn: () => apiFetch<RhEmployee[]>("/rh/employees"),
  });

  const rows = specialLeavesQuery.data?.rows ?? emptyRows;
  const totals = specialLeavesQuery.data?.totals ?? emptyTotals;
  const employees = useMemo(
    () =>
      (employeesQuery.data ?? emptyEmployees).filter((employee) => employee.status !== "inactive"),
    [employeesQuery.data],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["rh-special-leaves"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const createSpecialLeave = useMutation({
    mutationFn: (payload: SpecialLeavePayload) =>
      apiFetch<SpecialLeaveRow>("/rh/special-leaves", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Congé spécial créé");
      refresh();
    },
  });

  const updateSpecialLeave = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SpecialLeavePayload }) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Congé spécial mis à jour");
      refresh();
    },
  });

  const decideEvent = useMutation({
    mutationFn: ({
      id,
      status,
      rhComment,
    }: {
      id: string;
      status: "IN_REVIEW" | "REJECTED" | "APPROVED";
      rhComment: string;
    }) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, rhComment }),
      }),
    onSuccess: () => {
      toast.success("Événement mis à jour");
      refresh();
    },
  });

  const cancelSpecialLeave = useMutation({
    mutationFn: (id: string) =>
      apiFetch<SpecialLeaveRow>(`/rh/special-leaves/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Congé spécial annulé");
      refresh();
    },
    onError: (error) => {
      toast.error("Annulation impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const importSpecialLeaves = useMutation({
    mutationFn: (rows: SpecialLeaveImportRow[]) =>
      apiFetch<SpecialLeaveImportResponse>("/rh/special-leaves/import", {
        method: "POST",
        body: JSON.stringify({ rows }),
      }),
    onSuccess: (response) => {
      setLastImport(response);
      setImportRows(emptyImportRows);
      toast.success(`${response.imported} conge(s) importe(s), ${response.skipped} ignore(s)`);
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
        row.department.toLowerCase().includes(query) ||
        row.eventLabel.toLowerCase().includes(query) ||
        row.reference.toLowerCase().includes(query);
      const matchesStatus = !statusFilter || row.statusCode === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);
  const eventRows = useMemo(
    () => filteredRows.filter((row) => row.leaveTypeCode === "EVT"),
    [filteredRows],
  );
  const specialRows = useMemo(
    () => filteredRows.filter((row) => row.leaveTypeCode !== "EVT"),
    [filteredRows],
  );
  const importPreviewTotals = useMemo(
    () => ({
      rows: importRows.length,
      approved: importRows.filter((row) => (row.status ?? "APPROVED") === "APPROVED").length,
    }),
    [importRows],
  );
  const lastImportRows = lastImport?.rows ?? [];

  const isMutating =
    createSpecialLeave.isPending ||
    updateSpecialLeave.isPending ||
    cancelSpecialLeave.isPending ||
    decideEvent.isPending ||
    importSpecialLeaves.isPending;

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const sheet = file.name.toLowerCase().endsWith(".csv")
        ? parseCsvText(await file.text())
        : ((await readSheet(file)) as ExcelReadResult);
      const rows = parseImportRows(sheet);
      setImportRows(rows);
      setLastImport(null);
      toast.success(`${rows.length} ligne(s) prete(s) a importer`);
    } catch (error) {
      toast.error("Lecture impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  const clearImport = () => {
    setImportRows(emptyImportRows);
    setLastImport(null);
  };

  const cancelRow = (row: SpecialLeaveRow) => {
    setCancelTarget(row);
  };

  const confirmCancel = () => {
    if (!cancelTarget) return;
    cancelSpecialLeave.mutate(cancelTarget.id, {
      onSettled: () => setCancelTarget(null),
    });
  };

  const decideEventRow = (
    row: SpecialLeaveRow,
    status: "IN_REVIEW" | "REJECTED" | "APPROVED",
    rhComment: string,
  ) => decideEvent.mutateAsync({ id: row.id, status, rhComment });

  return (
    <AppShell title="Congés spéciaux (RH)">
      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <AlertDialogTrigger asChild>
          <span className="hidden" aria-hidden="true" />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmation requise</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? `Vous allez annuler ${cancelTarget.reference} de ${cancelTarget.employeeName}. Cette action est irreversible.`
                : "Vous allez annuler ce congé spécial."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Retour</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isMutating}
              onClick={confirmCancel}
            >
              Confirmer l'annulation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="mb-6 p-5">
        <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_auto_auto_auto] xl:items-end">
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Recherche</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
                placeholder="Employé, événement, référence..."
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
              onChange={(event) =>
                setStatusFilter(event.target.value as "" | SpecialLeaveStatusCode)
              }
            >
              <option value="">Tous statuts</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <DateRangeFilter value={dateRange} onChange={setDateRange} compact />
          <Button variant="outline" onClick={refresh} disabled={specialLeavesQuery.isFetching}>
            <RefreshCw className="size-4" /> Actualiser
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Demandes spéciales" value={totals.total} tone="blue" />
        <StatCard label="Validées" value={totals.approved} tone="green" />
        <StatCard label="Jours utilisés" value={totals.days} suffix="jour(s)" tone="orange" />
        <StatCard label="À traiter" value={totals.pending} tone="yellow" />
      </div>

      <Card className="mt-4 p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="font-semibold">Import Excel des congés spéciaux</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Le fichier ne contient pas de colonne jours : la durée est calculée automatiquement.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadImportTemplate}>
              <Download className="size-4" /> Modele
            </Button>
            <Button variant="outline" onClick={() => importInputRef.current?.click()}>
              <FileUp className="size-4" /> Charger Excel
            </Button>
            <Button
              variant="primary"
              disabled={!importRows.length || isMutating}
              onClick={() => importSpecialLeaves.mutate(importRows)}
            >
              <UploadCloud className="size-4" />
              {importSpecialLeaves.isPending ? "Import..." : "Importer"}
            </Button>
            <Button
              variant="ghost"
              disabled={!importRows.length && !lastImport}
              onClick={clearImport}
            >
              <Trash2 className="size-4" /> Vider
            </Button>
            <input
              ref={importInputRef}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
            />
          </div>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-3 border-b px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="font-semibold">Registre des congés spéciaux</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Quota annuel séparé, justificatifs et validations RH.
            </p>
          </div>
          <NewSpecialLeaveDialog
            employees={employees}
            disabled={isMutating}
            onCreate={(payload) => createSpecialLeave.mutateAsync(payload)}
          />
        </div>

        {(importRows.length > 0 || lastImport) && (
          <div className="border-b bg-muted/15 px-5 py-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold">
                  {importRows.length ? "Apercu de l'import Excel" : "Dernier import Excel"}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {importRows.length
                    ? `${importPreviewTotals.rows} ligne(s), ${importPreviewTotals.approved} validee(s) par defaut. Les jours seront calcules seulement si Date debut est renseignee.`
                    : `${lastImport?.imported ?? 0} importee(s), ${lastImport?.skipped ?? 0} ignoree(s).`}
                </p>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-md border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Matricule</th>
                    <th className="px-4 py-2">Evenement</th>
                    <th className="px-4 py-2">Date evenement</th>
                    <th className="px-4 py-2">Date debut</th>
                    <th className="px-4 py-2">Statut</th>
                    <th className="px-4 py-2">Jours calcules</th>
                    <th className="px-4 py-2">Resultat</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {importRows.length
                    ? importRows.slice(0, 8).map((row) => (
                        <tr
                          key={`${row.matricule}-${row.eventLabel}-${row.eventDate ?? "no-event-date"}-${row.startDate ?? "no-start-date"}`}
                        >
                          <td className="px-4 py-2 font-medium">{row.matricule}</td>
                          <td className="px-4 py-2">{row.eventLabel}</td>
                          <td className="px-4 py-2">{formatDate(row.eventDate)}</td>
                          <td className="px-4 py-2">{formatDate(row.startDate)}</td>
                          <td className="px-4 py-2">{row.status ?? "APPROVED"}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {row.startDate ? "Calcul serveur" : "Non calculé"}
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={row.startDate ? "pending" : "neutral"}>
                              {row.startDate ? "Pret" : "Date debut absente"}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    : lastImportRows.slice(0, 8).map((row) => (
                        <tr
                          key={`${row.rowNumber}-${row.matricule}-${row.eventDate ?? "no-event-date"}-${row.startDate ?? "no-start-date"}`}
                        >
                          <td className="px-4 py-2 font-medium">{row.matricule}</td>
                          <td className="px-4 py-2">{row.eventLabel}</td>
                          <td className="px-4 py-2">{formatDate(row.eventDate)}</td>
                          <td className="px-4 py-2">{formatDate(row.startDate)}</td>
                          <td className="px-4 py-2">{row.status}</td>
                          <td className="px-4 py-2">
                            {row.endDate
                              ? `${formatNumber(row.days)} j, fin ${formatDate(row.endDate)}`
                              : "Non calculé"}
                          </td>
                          <td className="px-4 py-2">
                            <Badge tone={row.imported ? "valid" : "neutral"}>
                              {row.imported ? "Importe" : (row.skippedReason ?? "Ignore")}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {specialLeavesQuery.isLoading ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Chargement des congés spéciaux...
          </div>
        ) : specialLeavesQuery.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            Impossible de charger les congés spéciaux.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Aucun congé spécial trouvé.
          </div>
        ) : (
          <div className="hidden overflow-x-auto xl:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Employé</th>
                  <th className="px-4 py-3">Événement</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredRows.map((row) => {
                  return (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.employeeName}</div>
                        <div className="text-xs text-muted-foreground">{row.department}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.eventLabel}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="inline-flex items-center gap-2">
                          <CalendarDays className="size-4 text-muted-foreground" />
                          {formatDate(row.startDate)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={row.status}>{row.statusLabel}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end">
                          <SpecialLeaveActions
                            row={row}
                            employees={employees}
                            disabled={isMutating}
                            onCancel={cancelRow}
                            onDecideEvent={decideEventRow}
                            onSave={(id, payload) =>
                              updateSpecialLeave.mutateAsync({ id, payload })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Aucun congé spécial trouvé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
