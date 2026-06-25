import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readSheet } from "read-excel-file/browser";
import { AppShell } from "@/components/AppShell";
import {
  DateRangeFilter,
  allDateRange,
  isDateInRange,
  type DateRangeValue,
} from "@/components/DateRangeFilter";
import { Card, CardHeader, Button, Badge, StatCard } from "@/components/ui-kit";
import { Search, Download, UserPlus, FileUp, Trash2 } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type EmployeeRole = "employee" | "manager" | "rh";
type EmployeeStatus = "active" | "leave" | "inactive";

type EmployeeBase = {
  matricule: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  sexe: "M" | "F";
  embauche: string;
  passifInitial: number;
  dept: string;
  poste: string;
  email: string;
  n1Matricule: string;
  n2Matricule: string;
  n3Matricule: string;
  roles: EmployeeRole[];
};

type Employee = EmployeeBase & {
  id: string;
  role?: EmployeeRole;
  status: EmployeeStatus;
};

type EmployeeCreatePayload = EmployeeBase & { role?: EmployeeRole };
type EmployeeUpdatePayload = Partial<
  EmployeeBase & { role?: EmployeeRole; status: EmployeeStatus }
>;

type ImportEmployeesResponse = {
  created: number;
  updated: number;
  employees: Employee[];
};

type ImportField =
  | "matricule"
  | "nom"
  | "prenom"
  | "dateNaissance"
  | "sexe"
  | "embauche"
  | "passifInitial"
  | "dept"
  | "poste"
  | "email"
  | "n1Matricule"
  | "n2Matricule"
  | "n3Matricule"
  | "role";

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };

const DEPARTMENTS = [
  "Direction Generale",
  "Commercial",
  "Operations et Supply Chain",
  "Infrastructure",
  "Ressources Humaines",
  "Recherche et Developement",
  "Finances",
  "QHSE",
  "Systeme Information",
];
const ROLE_OPTIONS: EmployeeRole[] = ["employee", "manager", "rh"];

const roleLabel: Record<EmployeeRole, string> = {
  employee: "Employé",
  manager: "Manager",
  rh: "RH",
};

const PAGE_SIZE = 6;

const statusMap: Record<EmployeeStatus, "valid" | "pending" | "rejected"> = {
  active: "valid",
  leave: "pending",
  inactive: "rejected",
};

const statusLabel: Record<EmployeeStatus, string> = {
  active: "Actif",
  leave: "En congé",
  inactive: "Inactif",
};

const FIELD_LABELS = {
  matricule: "Matricule",
  nom: "Nom",
  prenom: "Prénom",
  dateNaissance: "Date naissance",
  sexe: "Sexe",
  embauche: "Date d'embauche",
  passifInitial: "Passif",
  dept: "Pôle",
  poste: "Emploi occupé",
  email: "E-mail",
  n1Matricule: "N+1",
  n2Matricule: "N+2",
  n3Matricule: "N+3",
  role: "Rôle",
  roles: "Rôles",
  status: "Statut",
};

const FIELD_HINTS = {
  dateNaissance: { type: "date" as const },
  sexe: { type: "select" as const, options: ["M", "F"] },
  embauche: { type: "date" as const },
  passifInitial: { type: "number" as const, min: undefined },
  dept: { type: "select" as const, options: DEPARTMENTS },
  roles: {
    type: "multiselect" as const,
    options: ROLE_OPTIONS,
    render: (value: unknown) => {
      if (Array.isArray(value)) return formatEmployeeRoles(value as EmployeeRole[]);
      return roleLabel[value as EmployeeRole] ?? String(value ?? "");
    },
  },
  status: {
    type: "select" as const,
    options: ["active", "leave", "inactive"],
    render: (value: unknown) => statusLabel[value as EmployeeStatus] ?? String(value ?? ""),
  },
};

const EMPTY: EmployeeCreatePayload = {
  matricule: "",
  nom: "",
  prenom: "",
  dateNaissance: "",
  sexe: "M",
  embauche: "",
  passifInitial: 0,
  dept: "Commercial",
  poste: "",
  email: "",
  n1Matricule: "",
  n2Matricule: "",
  n3Matricule: "",
  roles: ["employee"],
};

const requiredImportFields: ImportField[] = [
  "matricule",
  "nom",
  "prenom",
  "dateNaissance",
  "sexe",
  "embauche",
  "dept",
  "poste",
  "email",
];

const headerMap: Record<string, ImportField> = {
  matricule: "matricule",
  nom: "nom",
  prenom: "prenom",
  datenaissance: "dateNaissance",
  datedenaissance: "dateNaissance",
  sexe: "sexe",
  datedembauche: "embauche",
  dateembauche: "embauche",
  embauche: "embauche",
  passifinitial: "passifInitial",
  passif: "passifInitial",
  passifconges: "passifInitial",
  passifhistorique: "passifInitial",
  n1: "n1Matricule",
  n1matricule: "n1Matricule",
  nplus1: "n1Matricule",
  n2: "n2Matricule",
  n2matricule: "n2Matricule",
  nplus2: "n2Matricule",
  n3: "n3Matricule",
  n3matricule: "n3Matricule",
  nplus3: "n3Matricule",
  pole: "dept",
  departement: "dept",
  emploioccupe: "poste",
  posteoccupe: "poste",
  poste: "poste",
  email: "email",
  mail: "email",
  role: "role",
};

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportEmployeesCsv(employees: Employee[]) {
  const headers = [
    "Matricule",
    "Nom",
    "Prénom",
    "Date naissance",
    "Sexe",
    "Date d'embauche",
    "Passif",
    "Pôle",
    "Emploi occupé",
    "N+1",
    "N+2",
    "N+3",
    "Rôle",
    "E-mail",
    "Statut",
  ];
  const rows = employees.map((employee) => [
    employee.matricule,
    employee.nom,
    employee.prenom,
    employee.dateNaissance,
    employee.sexe,
    employee.embauche,
    employee.passifInitial,
    employee.dept,
    employee.poste,
    employee.n1Matricule,
    employee.n2Matricule,
    employee.n3Matricule,
    formatEmployeeRoles(getEmployeeRoles(employee)),
    employee.email,
    statusLabel[employee.status],
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(String(value))).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `personnel-rh-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function toEditableEmployee(employee: Employee): EmployeeUpdatePayload {
  return {
    matricule: employee.matricule,
    nom: employee.nom,
    prenom: employee.prenom,
    dateNaissance: employee.dateNaissance,
    sexe: employee.sexe,
    embauche: employee.embauche,
    passifInitial: employee.passifInitial,
    dept: employee.dept,
    poste: employee.poste,
    email: employee.email,
    n1Matricule: employee.n1Matricule,
    n2Matricule: employee.n2Matricule,
    n3Matricule: employee.n3Matricule,
    roles: getEmployeeRoles(employee),
    status: employee.status,
  };
}

function normalizeEmployeeRoles(roles: EmployeeRole[]) {
  return ROLE_OPTIONS.filter((role) => roles.includes(role));
}

function getEmployeeRoles(employee: Pick<Employee, "roles" | "role">) {
  return normalizeEmployeeRoles(
    employee.roles?.length ? employee.roles : [employee.role ?? "employee"],
  );
}

function formatEmployeeRoles(roles: EmployeeRole[]) {
  return normalizeEmployeeRoles(roles)
    .map((role) => roleLabel[role])
    .join(", ");
}

function normalizeHeader(value: ExcelCell) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeExcelRows(result: ExcelReadResult): ExcelCell[][] {
  if (Array.isArray(result) && result.every(Array.isArray)) {
    return result;
  }

  if (!Array.isArray(result) && Array.isArray(result.rows) && result.rows.every(Array.isArray)) {
    return result.rows;
  }

  throw new Error(
    "Format Excel non reconnu. Utilise un fichier .xlsx avec les colonnes du personnel.",
  );
}

function getHeaderFields(row: ExcelCell[]) {
  return row.map((header) => headerMap[normalizeHeader(header)]);
}

function findHeaderRowIndex(rows: ExcelCell[][]) {
  return rows.findIndex((row) => {
    const fields = getHeaderFields(row).filter(Boolean);
    return fields.includes("matricule") && fields.includes("nom") && fields.includes("prenom");
  });
}

function cellToString(value: ExcelCell) {
  return String(value ?? "").trim();
}

function cellToDateInput(value: ExcelCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    const date = new Date(Date.UTC(1899, 11, 30 + value));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  const raw = cellToString(value);
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const frMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (frMatch) {
    const [, day, month, year] = frMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return raw;
}

function cellToNumber(value: ExcelCell, rowNumber: number, label: string) {
  const raw = cellToString(value);
  if (!raw) return 0;

  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Ligne ${rowNumber}: ${label} invalide`);
  }

  return Math.round(parsed * 10) / 10;
}

function parseSexe(value: ExcelCell, rowNumber: number): Employee["sexe"] {
  const normalized = normalizeHeader(value);
  if (["m", "masculin", "homme"].includes(normalized)) return "M";
  if (["f", "feminin", "femme"].includes(normalized)) return "F";
  throw new Error(`Ligne ${rowNumber}: sexe invalide`);
}

function parseRoleToken(value: string, rowNumber: number): EmployeeRole {
  const normalized = normalizeHeader(value);
  if (["manager", "manageur"].includes(normalized)) return "manager";
  if (["rh", "ressourceshumaines"].includes(normalized)) return "rh";
  if (["employe", "employee", "employer", "collaborateur"].includes(normalized)) {
    return "employee";
  }
  throw new Error(`Ligne ${rowNumber}: rôle invalide`);
}

function parseRoles(value: ExcelCell, rowNumber: number): EmployeeRole[] {
  const tokens = cellToString(value)
    .split(/[,;+/|]/)
    .map((token) => token.trim())
    .filter(Boolean);
  const roles = (tokens.length ? tokens : ["employee"])
    .map((token) => parseRoleToken(token, rowNumber))
    .filter((role, index, list) => list.indexOf(role) === index);

  return roles.length ? normalizeEmployeeRoles(roles) : ["employee"];
}

async function parseEmployeesFromExcel(file: File): Promise<EmployeeCreatePayload[]> {
  const rows = normalizeExcelRows((await readSheet(file)) as ExcelReadResult);
  const headerRowIndex = findHeaderRowIndex(rows);

  if (headerRowIndex === -1) {
    throw new Error("Ligne d'en-têtes introuvable: Matricule, Nom, Prénom sont requis.");
  }

  const headers = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1);
  const fields = getHeaderFields(headers);
  const missingFields = requiredImportFields.filter((field) => !fields.includes(field));

  if (missingFields.length > 0) {
    const labels = missingFields.map((field) => FIELD_LABELS[field]).join(", ");
    throw new Error(`Colonnes manquantes: ${labels}`);
  }

  return dataRows.flatMap((row, index) => {
    const rowNumber = index + 2;
    if (row.every((cell) => cellToString(cell) === "")) return [];

    const values = fields.reduce<Partial<Record<ImportField, ExcelCell>>>((acc, field, column) => {
      if (field) acc[field] = row[column];
      return acc;
    }, {});

    const employee: EmployeeCreatePayload = {
      ...EMPTY,
      matricule: cellToString(values.matricule),
      nom: cellToString(values.nom).toUpperCase(),
      prenom: cellToString(values.prenom),
      dateNaissance: cellToDateInput(values.dateNaissance),
      sexe: parseSexe(values.sexe, rowNumber),
      embauche: cellToDateInput(values.embauche),
      passifInitial: values.passifInitial
        ? cellToNumber(values.passifInitial, rowNumber, "passif initial")
        : 0,
      dept: cellToString(values.dept),
      poste: cellToString(values.poste),
      email: cellToString(values.email),
      n1Matricule: cellToString(values.n1Matricule),
      n2Matricule: cellToString(values.n2Matricule),
      n3Matricule: cellToString(values.n3Matricule),
      roles: values.role ? parseRoles(values.role, rowNumber) : ["employee"],
    };

    const missingValues = requiredImportFields.filter((field) => !employee[field]);
    if (missingValues.length > 0) {
      const labels = missingValues.map((field) => FIELD_LABELS[field]).join(", ");
      throw new Error(`Ligne ${rowNumber}: valeurs manquantes (${labels})`);
    }

    return [employee];
  });
}

function NewEmployeeDialog({
  onCreate,
}: {
  onCreate: (employee: EmployeeCreatePayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<EmployeeCreatePayload>(EMPTY);
  const set = <K extends keyof EmployeeCreatePayload>(key: K, value: EmployeeCreatePayload[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const input = "w-full rounded-md border px-3 py-2 text-sm bg-background";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setDraft(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" /> Nouveau
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvel employé</DialogTitle>
          <DialogDescription>Renseignez les informations du nouvel employé.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const missingFields = requiredImportFields.filter((field) => !draft[field]);

            if (missingFields.length > 0) {
              toast.error("Champs obligatoires manquants", {
                description: missingFields.map((field) => FIELD_LABELS[field]).join(", "),
              });
              return;
            }
            if (draft.roles.length === 0) {
              toast.error("Sélectionnez au moins un rôle");
              return;
            }

            setSubmitting(true);
            try {
              await onCreate({ ...draft, nom: draft.nom.toUpperCase() });
              toast.success(`${draft.prenom} ${draft.nom} ajouté(e)`);
              setOpen(false);
              setDraft(EMPTY);
            } catch (error) {
              toast.error("Création impossible", {
                description: error instanceof Error ? error.message : "Erreur inconnue",
              });
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Matricule *</span>
            <input
              className={input}
              value={draft.matricule}
              onChange={(event) => set("matricule", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Nom *</span>
            <input
              className={input}
              value={draft.nom}
              onChange={(event) => set("nom", event.target.value.toUpperCase())}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Prénom *</span>
            <input
              className={input}
              value={draft.prenom}
              onChange={(event) => set("prenom", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Date naissance *</span>
            <input
              type="date"
              className={input}
              value={draft.dateNaissance}
              onChange={(event) => set("dateNaissance", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Sexe *</span>
            <select
              className={input}
              value={draft.sexe}
              onChange={(event) => set("sexe", event.target.value as Employee["sexe"])}
              required
            >
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Date d'embauche *</span>
            <input
              type="date"
              className={input}
              value={draft.embauche}
              onChange={(event) => set("embauche", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Passif</span>
            <input
              type="number"
              step="0.1"
              max="72"
              className={input}
              value={draft.passifInitial}
              onChange={(event) => set("passifInitial", Number(event.target.value || 0))}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Pôle *</span>
            <select
              className={input}
              value={draft.dept}
              onChange={(event) => set("dept", event.target.value)}
              required
            >
              {DEPARTMENTS.map((department) => (
                <option key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Emploi occupé *</span>
            <input
              className={input}
              value={draft.poste}
              onChange={(event) => set("poste", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">E-mail *</span>
            <input
              type="email"
              className={input}
              value={draft.email}
              onChange={(event) => set("email", event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">N+1 matricule</span>
            <input
              className={input}
              value={draft.n1Matricule}
              onChange={(event) => set("n1Matricule", event.target.value)}
              placeholder="Matricule du N+1"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">N+2 matricule</span>
            <input
              className={input}
              value={draft.n2Matricule}
              onChange={(event) => set("n2Matricule", event.target.value)}
              placeholder="Matricule du N+2"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">N+3 matricule</span>
            <input
              className={input}
              value={draft.n3Matricule}
              onChange={(event) => set("n3Matricule", event.target.value)}
              placeholder="Matricule du N+3"
            />
          </label>
          <div className="grid gap-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Rôles *</span>
            <div className={`${input} grid gap-2`}>
              {ROLE_OPTIONS.map((role) => {
                const checked = draft.roles.includes(role);
                return (
                  <label key={role} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        set(
                          "roles",
                          event.target.checked
                            ? normalizeEmployeeRoles([...draft.roles, role])
                            : draft.roles.filter((value) => value !== role),
                        )
                      }
                    />
                    <span>{roleLabel[role]}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter className="sm:col-span-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Création..." : "Créer l'employé"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportEmployeesButton({
  onImport,
}: {
  onImport: (employees: EmployeeCreatePayload[]) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setLoading(true);
    try {
      const importedEmployees = await parseEmployeesFromExcel(file);
      if (importedEmployees.length === 0) {
        toast.error("Aucun employé trouvé dans le fichier");
        return;
      }
      await onImport(importedEmployees);
    } catch (error) {
      toast.error("Import Excel impossible", {
        description: error instanceof Error ? error.message : "Fichier non reconnu",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="size-4" /> {loading ? "Import..." : "Importer Excel"}
      </Button>
    </>
  );
}

export function RhEmployes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => allDateRange());
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const employeesQuery = useQuery({
    queryKey: ["rh-employees"],
    queryFn: () => apiFetch<Employee[]>("/rh/employees"),
  });

  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const refreshEmployees = () => queryClient.invalidateQueries({ queryKey: ["rh-employees"] });

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => employees.some((employee) => employee.id === id)),
    );
  }, [employees]);

  const createEmployee = useMutation({
    mutationFn: (employee: EmployeeCreatePayload) =>
      apiFetch<Employee>("/rh/employees", {
        method: "POST",
        body: JSON.stringify(employee),
      }),
    onSuccess: () => refreshEmployees(),
  });

  const importEmployeesMutation = useMutation({
    mutationFn: (incomingEmployees: EmployeeCreatePayload[]) =>
      apiFetch<ImportEmployeesResponse>("/rh/employees/import", {
        method: "POST",
        body: JSON.stringify({ employees: incomingEmployees }),
      }),
    onSuccess: (result) => {
      refreshEmployees();
      setPage(1);
      toast.success(`${result.created} employé(s) créé(s)`, {
        description: result.updated > 0 ? `${result.updated} employé(s) mis à jour` : undefined,
      });
    },
  });

  const updateEmployee = useMutation({
    mutationFn: ({ id, employee }: { id: string; employee: EmployeeUpdatePayload }) =>
      apiFetch<Employee>(`/rh/employees/${id}`, {
        method: "PATCH",
        body: JSON.stringify(employee),
      }),
    onSuccess: () => refreshEmployees(),
    onError: (error) => {
      toast.error("Modification impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const deactivateEmployee = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Employee>(`/rh/employees/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => refreshEmployees(),
    onError: (error) => {
      toast.error("Suppression impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    },
  });

  const filtered = employees.filter((employee) => {
    const query = search.toLowerCase();
    const matchQuery =
      !query ||
      employee.matricule.toLowerCase().includes(query) ||
      employee.nom.toLowerCase().includes(query) ||
      employee.prenom.toLowerCase().includes(query) ||
      employee.email.toLowerCase().includes(query) ||
      formatEmployeeRoles(getEmployeeRoles(employee)).toLowerCase().includes(query);
    const matchDepartment = !deptFilter || employee.dept === deptFilter;
    const matchDate = isDateInRange(employee.embauche, dateRange);
    return matchQuery && matchDepartment && matchDate;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const firstRow = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(currentPage * PAGE_SIZE, filtered.length);
  const paginatedEmployees = filtered.slice(firstRow === 0 ? 0 : firstRow - 1, lastRow);
  const filteredIds = filtered.map((employee) => employee.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const hasActiveFilters = Boolean(search || deptFilter || dateRange.dateFrom || dateRange.dateTo);
  const departmentOptions = Array.from(
    new Set([...DEPARTMENTS, ...employees.map((employee) => employee.dept).filter(Boolean)]),
  );

  const exportFilteredEmployees = () => {
    if (filtered.length === 0) {
      toast.info("Aucun employé à exporter");
      return;
    }

    exportEmployeesCsv(filtered);
    toast.success(`${filtered.length} employé(s) exporté(s)`);
  };

  const importEmployees = async (incomingEmployees: EmployeeCreatePayload[]) => {
    await importEmployeesMutation.mutateAsync(incomingEmployees);
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
      return;
    }
    setSelectedIds((current) => Array.from(new Set([...current, ...filteredIds])));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  };

  const bulkDeactivateEmployees = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Désactiver ${selectedIds.length} employé(s) ?`)) return;

    const results = await Promise.allSettled(
      selectedIds.map((id) => apiFetch<Employee>(`/rh/employees/${id}`, { method: "DELETE" })),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    const deactivated = selectedIds.filter((_, index) => results[index]?.status === "fulfilled");

    setSelectedIds((current) => current.filter((id) => !deactivated.includes(id)));
    await refreshEmployees();

    if (failed === 0) {
      toast.success(`${deactivated.length} employé(s) désactivé(s)`);
      return;
    }

    toast.error("Désactivation partielle", {
      description: `${deactivated.length} désactivé(s), ${failed} en échec`,
    });
  };

  return (
    <AppShell title="Employés" subtitle="Gestion des employés">
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Recherche
            <div className="relative">
              <Search className="size-4 pointer-events-none absolute left-2.5 top-2.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Matricule, nom, prénom, rôle, e-mail..."
                className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm"
              />
            </div>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Pôle
            <select
              value={deptFilter}
              onChange={(event) => {
                setDeptFilter(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border bg-card px-3 text-sm"
            >
              <option value="">Tous pôles</option>
              {departmentOptions.map((department) => (
                <option key={department}>{department}</option>
              ))}
            </select>
          </label>
          <DateRangeFilter
            value={dateRange}
            onChange={(nextRange) => {
              setDateRange(nextRange);
              setPage(1);
            }}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Total employés" value={String(employees.length)} tone="blue" />
        <StatCard
          label="En activité"
          value={String(employees.filter((employee) => employee.status === "active").length)}
          tone="green"
        />
        <StatCard
          label="En congé"
          value={String(employees.filter((employee) => employee.status === "leave").length)}
          tone="orange"
        />
        <StatCard
          label="Inactifs"
          value={String(employees.filter((employee) => employee.status === "inactive").length)}
          tone="red"
        />
      </div>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap gap-2">
          <ImportEmployeesButton onImport={importEmployees} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Liste des employés"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={exportFilteredEmployees}>
                <Download className="size-4" /> Export
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={bulkDeactivateEmployees}
                disabled={selectedIds.length === 0}
              >
                <Trash2 className="size-4" /> Supprimer ({selectedIds.length})
              </Button>
              <NewEmployeeDialog onCreate={(employee) => createEmployee.mutateAsync(employee)} />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1420px]">
            <thead>
              <tr className="text-xs text-muted-foreground border-b bg-muted/30">
                <th className="text-left px-3 py-3 font-medium w-10">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Sélectionner tous les employés filtrés"
                  />
                </th>
                <th className="text-left px-5 py-3 font-medium">Matricule</th>
                <th className="text-left px-5 py-3 font-medium">Employé</th>
                <th className="text-left px-3 py-3 font-medium">Date naissance</th>
                <th className="text-left px-3 py-3 font-medium">Sexe</th>
                <th className="text-left px-3 py-3 font-medium">Embauche</th>
                <th className="text-left px-3 py-3 font-medium">Pôle</th>
                <th className="text-left px-3 py-3 font-medium">Emploi occupé</th>
                <th className="text-left px-3 py-3 font-medium">Rôle</th>
                <th className="text-left px-3 py-3 font-medium">E-mail</th>
                <th className="text-left px-3 py-3 font-medium">Statut</th>
                <th className="text-right px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {employeesQuery.isLoading && (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-muted-foreground">
                    Chargement des employés...
                  </td>
                </tr>
              )}
              {employeesQuery.isError && (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-muted-foreground">
                    <div className="grid justify-items-center gap-3">
                      <span>
                        {employeesQuery.error instanceof Error
                          ? employeesQuery.error.message
                          : "Impossible de charger les employés"}
                      </span>
                      <Button variant="outline" onClick={() => employeesQuery.refetch()}>
                        Réessayer
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
              {!employeesQuery.isLoading &&
                !employeesQuery.isError &&
                paginatedEmployees.map((employee) => {
                  const editableEmployee = toEditableEmployee(employee);
                  return (
                    <tr key={employee.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(employee.id)}
                          onChange={() => toggleSelected(employee.id)}
                          aria-label={`Sélectionner ${employee.prenom} ${employee.nom}`}
                        />
                      </td>
                      <td className="px-5 py-3 font-medium whitespace-nowrap">
                        {employee.matricule}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-full bg-gradient-to-br from-stat-blue-fg to-stat-purple-fg text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                            {employee.prenom[0]}
                            {employee.nom[0]}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {employee.prenom} {employee.nom}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                        {employee.dateNaissance}
                      </td>
                      <td className="px-3 py-3">{employee.sexe}</td>
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                        {employee.embauche}
                      </td>
                      <td className="px-3 py-3">{employee.dept}</td>
                      <td className="px-3 py-3 text-muted-foreground">{employee.poste}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {getEmployeeRoles(employee).map((role) => (
                            <Badge key={role} tone={role === "employee" ? "neutral" : "info"}>
                              {roleLabel[role]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        <div className="truncate max-w-[220px]">{employee.email}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusMap[employee.status]}>
                          {statusLabel[employee.status]}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <RowActions
                          label={`l'employé ${employee.prenom} ${employee.nom}`}
                          item={editableEmployee as Record<string, unknown>}
                          fields={autoFields(
                            editableEmployee as Record<string, unknown>,
                            FIELD_LABELS,
                            FIELD_HINTS,
                          )}
                          onSave={(nextEmployee) =>
                            updateEmployee.mutate({
                              id: employee.id,
                              employee: nextEmployee as EmployeeUpdatePayload,
                            })
                          }
                          onRemove={() => deactivateEmployee.mutate(employee.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              {!employeesQuery.isLoading && !employeesQuery.isError && filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-muted-foreground">
                    Aucun employé trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t text-xs text-muted-foreground">
          <span>
            Affichage {firstRow}-{lastRow} sur {filtered.length}
            {hasActiveFilters ? ` (${employees.length} au total)` : ""}
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {currentPage}/{totalPages}
            </span>
            <Button
              variant="outline"
              disabled={currentPage <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Suivant
            </Button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}
