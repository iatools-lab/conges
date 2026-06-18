import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, Badge, Button } from "@/components/ui-kit";
import { Download, FileUp, Plus, Search, Trash2 } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { readSheet } from "read-excel-file/browser";
import { toast } from "sonner";

type BusinessRole = "EMPLOYE" | "MANAGER" | "RH";
type EmployeeImportRole = "employee" | "manager" | "rh";
type UserStatus = "ACTIVE" | "ON_LEAVE" | "INACTIVE";
type UiRow = {
  id: string;
  matricule: string;
  nom: string;
  prenom: string;
  n: string;
  e: string;
  r: string;
  roles: BusinessRole[];
  d: string;
  m: string;
  dateNaissance: string;
  sexe: "M" | "F" | "";
  embauche: string;
  passifInitial: number;
  poste: string;
  status: UserStatus;
};
type UserApiRow = {
  id: string;
  matricule?: string;
  prenom?: string;
  nom?: string;
  dateNaissance?: string | null;
  sexe?: "M" | "F";
  dateEmbauche?: string;
  passifInitial?: number;
  poste?: string;
  email?: string;
  status?: UserStatus;
  n1Id?: string | null;
  departmentId?: string | null;
  n1?: { prenom?: string; nom?: string } | null;
  manager?: { prenom?: string; nom?: string } | null;
  department?: { name?: string } | null;
  roles?: Array<{ role: string }>;
};

type DepartmentApiRow = {
  id: string;
  name: string;
};

type UserFormState = {
  prenom: string;
  nom: string;
  email: string;
  matricule: string;
  poste: string;
  sexe: "M" | "F";
  roles: BusinessRole[];
  departmentId: string;
  managerId: string;
};

type EmployeeCreatePayload = {
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
  roles: EmployeeImportRole[];
};

type ImportEmployeesResponse = {
  created: number;
  updated: number;
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
  | "role";

type ExcelCell = string | number | boolean | Date | null | undefined;
type ExcelReadResult = ExcelCell[][] | { rows?: ExcelCell[][] };

const initialRows: UiRow[] = [];

const FIELD_LABELS = {};
const ROLE_OPTIONS: Array<{ value: BusinessRole; label: string }> = [
  { value: "EMPLOYE", label: "Employé" },
  { value: "MANAGER", label: "Manager" },
  { value: "RH", label: "RH" },
];
const ROLE_LABELS: Record<string, string> = {
  EMPLOYE: "Employé",
  MANAGER: "Manager",
  RH: "RH",
  ADMIN: "Admin",
};
const IMPORT_ROLE_LABELS: Record<EmployeeImportRole, string> = {
  employee: "Employé",
  manager: "Manager",
  rh: "RH",
};
const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "Actif",
  ON_LEAVE: "En congé",
  INACTIVE: "Inactif",
};

const EMPTY_IMPORT_EMPLOYEE: EmployeeCreatePayload = {
  matricule: "",
  nom: "",
  prenom: "",
  dateNaissance: "",
  sexe: "M",
  embauche: "",
  passifInitial: 0,
  dept: "",
  poste: "",
  email: "",
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

const importFieldLabels: Record<ImportField, string> = {
  matricule: "Matricule",
  nom: "Nom",
  prenom: "Prénom",
  dateNaissance: "Date naissance",
  sexe: "Sexe",
  embauche: "Date d'embauche",
  passifInitial: "Passif initial",
  dept: "Pôle",
  poste: "Emploi occupé",
  email: "E-mail",
  role: "Rôle(s)",
};

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
  passifconges: "passifInitial",
  passifhistorique: "passifInitial",
  pole: "dept",
  departement: "dept",
  emploioccupe: "poste",
  posteoccupe: "poste",
  poste: "poste",
  email: "email",
  mail: "email",
  role: "role",
};

function formatRoles(roles?: Array<{ role: string }>) {
  if (!roles || roles.length === 0) return "—";
  return roles.map((role) => ROLE_LABELS[role.role] ?? role.role).join(", ");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getBusinessRoles(roles?: Array<{ role: string }>): BusinessRole[] {
  const selected = (roles ?? [])
    .map((candidate) => candidate.role)
    .filter((role): role is BusinessRole => ROLE_OPTIONS.some((option) => option.value === role));

  return ROLE_OPTIONS.map((option) => option.value).filter((role) => selected.includes(role));
}

function normalizeBusinessRoles(roles: BusinessRole[]) {
  return ROLE_OPTIONS.map((option) => option.value).filter((role) => roles.includes(role));
}

function sameBusinessRoles(left: BusinessRole[], right: BusinessRole[]) {
  const normalizedLeft = normalizeBusinessRoles(left);
  const normalizedRight = normalizeBusinessRoles(right);

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((role, index) => role === normalizedRight[index])
  );
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/\r?\n/g, " ");
  return /[";\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function exportEmployeesCsv(rows: UiRow[]) {
  const headers = [
    "Matricule",
    "Nom",
    "Prénom",
    "Date naissance",
    "Sexe",
    "Date d'embauche",
    "Pôle",
    "Emploi occupé",
    "Rôle",
    "E-mail",
    "Statut",
  ];
  const dataRows = rows.map((row) => [
    row.matricule,
    row.nom,
    row.prenom,
    row.dateNaissance,
    row.sexe,
    row.embauche,
    row.d,
    row.poste,
    row.r,
    row.e,
    STATUS_LABELS[row.status] ?? row.status,
  ]);
  const csv = [headers, ...dataRows]
    .map((row) => row.map((value) => escapeCsvValue(String(value ?? ""))).join(";"))
    .join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `personnel-admin-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeHeader(value: ExcelCell) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeExcelRows(result: ExcelReadResult): ExcelCell[][] {
  if (Array.isArray(result) && result.every(Array.isArray)) return result;
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
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Ligne ${rowNumber}: ${label} invalide`);
  }

  return Math.round(parsed * 10) / 10;
}

function parseSexe(value: ExcelCell, rowNumber: number): EmployeeCreatePayload["sexe"] {
  const normalized = normalizeHeader(value);
  if (["m", "masculin", "homme"].includes(normalized)) return "M";
  if (["f", "feminin", "femme"].includes(normalized)) return "F";
  throw new Error(`Ligne ${rowNumber}: sexe invalide`);
}

function parseRoleToken(value: string, rowNumber: number): EmployeeImportRole {
  const normalized = normalizeHeader(value);
  if (["manager", "manageur"].includes(normalized)) return "manager";
  if (["rh", "ressourceshumaines"].includes(normalized)) return "rh";
  if (["employe", "employee", "employer", "collaborateur"].includes(normalized)) {
    return "employee";
  }
  throw new Error(`Ligne ${rowNumber}: rôle invalide`);
}

function parseRoles(value: ExcelCell, rowNumber: number): EmployeeImportRole[] {
  const tokens = cellToString(value)
    .split(/[,;+/|]/)
    .map((token) => token.trim())
    .filter(Boolean);
  const roles = (tokens.length ? tokens : ["employee"])
    .map((token) => parseRoleToken(token, rowNumber))
    .filter((role, index, list) => list.indexOf(role) === index);

  return roles.length ? roles : ["employee"];
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
    const labels = missingFields.map((field) => importFieldLabels[field]).join(", ");
    throw new Error(`Colonnes manquantes: ${labels}`);
  }

  return dataRows.flatMap((row, index) => {
    const rowNumber = headerRowIndex + index + 2;
    if (row.every((cell) => cellToString(cell) === "")) return [];

    const values = fields.reduce<Partial<Record<ImportField, ExcelCell>>>((acc, field, column) => {
      if (field) acc[field] = row[column];
      return acc;
    }, {});

    const employee: EmployeeCreatePayload = {
      ...EMPTY_IMPORT_EMPLOYEE,
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
      roles: values.role ? parseRoles(values.role, rowNumber) : ["employee"],
    };

    const missingValues = requiredImportFields.filter((field) => !employee[field]);
    if (missingValues.length > 0) {
      const labels = missingValues.map((field) => importFieldLabels[field]).join(", ");
      throw new Error(`Ligne ${rowNumber}: valeurs manquantes (${labels})`);
    }

    return [employee];
  });
}

function mapUsersToRows(rows: UserApiRow[]): UiRow[] {
  return rows.map((u) => ({
    id: u.id,
    matricule: u.matricule ?? "",
    nom: u.nom ?? "",
    prenom: u.prenom ?? "",
    n: `${u.prenom ?? ""} ${u.nom ?? ""}`.trim(),
    e: u.email ?? "",
    roles: getBusinessRoles(u.roles),
    r: formatRoles(u.roles),
    d: u.department?.name ?? "—",
    m: u.manager
      ? `${u.manager.prenom ?? ""} ${u.manager.nom ?? ""}`.trim()
      : u.n1
        ? `${u.n1.prenom ?? ""} ${u.n1.nom ?? ""}`.trim()
        : "—",
    dateNaissance: toDateInput(u.dateNaissance),
    sexe: u.sexe ?? "",
    embauche: toDateInput(u.dateEmbauche),
    passifInitial: Number(u.passifInitial ?? 0),
    poste: u.poste ?? "",
    status: u.status ?? "ACTIVE",
  }));
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

export function Users() {
  const [rows, setRows] = useState<UiRow[]>(initialRows);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managers, setManagers] = useState<Array<{ id: string; label: string }>>([]);

  const refreshUsers = async () => {
    const res = await apiFetch<{ rows: UserApiRow[] }>("/admin/users?limit=500");
    setRows(mapUsersToRows(res.rows));
    const managerOptions = res.rows
      .filter((u) => (u.roles ?? []).some((role) => role.role === "MANAGER"))
      .map((u) => ({
        id: u.id,
        label: `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || u.email || u.id,
      }));
    setManagers(managerOptions);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch<{ rows: UserApiRow[] }>("/admin/users?limit=500")
      .then((res) => {
        if (!mounted) return;
        setRows(mapUsersToRows(res.rows));
        const managerOptions = res.rows
          .filter((u) => (u.roles ?? []).some((role) => role.role === "MANAGER"))
          .map((u) => ({
            id: u.id,
            label: `${u.prenom ?? ""} ${u.nom ?? ""}`.trim() || u.email || u.id,
          }));
        setManagers(managerOptions);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const handleRemove = async (id: string) => {
    if (!confirm("Supprimer cet utilisateur ?")) return;
    try {
      await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
      setRows((rs) => rs.filter((r) => r.id !== id));
      setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
    } catch (err: unknown) {
      alert(errorMessage(err));
    }
  };

  const handleBulkRemove = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Supprimer ${selectedIds.length} utilisateur(s) ?`)) return;

    const results = await Promise.allSettled(
      selectedIds.map((id) => apiFetch(`/admin/users/${id}`, { method: "DELETE" })),
    );

    const failed = results.filter((result) => result.status === "rejected").length;
    const deletedIds = selectedIds.filter((_, index) => results[index]?.status === "fulfilled");

    setRows((currentRows) => currentRows.filter((row) => !deletedIds.includes(row.id)));
    setSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)));

    if (failed === 0) {
      toast.success(`${deletedIds.length} utilisateur(s) supprimé(s)`);
      return;
    }

    toast.error("Suppression partielle", {
      description: `${deletedIds.length} supprimé(s), ${failed} en échec`,
    });
  };

  // create / edit dialog
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id?: string; roles?: BusinessRole[] }>(null);
  const [form, setForm] = useState<UserFormState>({
    prenom: "",
    nom: "",
    email: "",
    matricule: "",
    poste: "",
    sexe: "M",
    roles: ["EMPLOYE"],
    departmentId: "",
    managerId: "",
  });
  const [departments, setDepartments] = useState<DepartmentApiRow[]>([]);

  useEffect(() => {
    apiFetch<{ rows: DepartmentApiRow[] }>("/admin/departments")
      .then((r) => setDepartments(r.rows))
      .catch(() => setDepartments([]));
  }, []);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) =>
      [
        row.n,
        row.matricule,
        row.e,
        row.r,
        row.d,
        row.m,
        row.poste,
        STATUS_LABELS[row.status] ?? row.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, rows]);

  const filteredIds = filteredRows.map((row) => row.id);
  const selectedCount = selectedIds.length;
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
      return;
    }

    setSelectedIds((current) => Array.from(new Set([...current, ...filteredIds])));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  };

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => rows.some((row) => row.id === id)));
  }, [rows]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      prenom: "",
      nom: "",
      email: "",
      matricule: "",
      poste: "",
      sexe: "M",
      roles: ["EMPLOYE"],
      departmentId: "",
      managerId: "",
    });
    setDlgOpen(true);
  };

  const openEdit = async (id: string) => {
    try {
      const user = await apiFetch<UserApiRow>(`/admin/users/${id}`);
      const roles = getBusinessRoles(user.roles);
      setEditing({ id, roles });
      setForm({
        prenom: user.prenom ?? "",
        nom: user.nom ?? "",
        email: user.email ?? "",
        matricule: user.matricule ?? "",
        poste: user.poste ?? "",
        sexe: user.sexe ?? "M",
        roles,
        departmentId: user.departmentId ?? "",
        managerId: user.n1Id ?? "",
      });
      setDlgOpen(true);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const submitForm = async () => {
    try {
      const selectedRoles = normalizeBusinessRoles(form.roles);
      if (selectedRoles.length === 0) {
        toast.error("Sélectionnez au moins un rôle");
        return;
      }
      const rolePayload = selectedRoles.map((role) => ({ role }));

      if (editing && editing.id) {
        await apiFetch(`/admin/users/${editing.id}`, {
          method: "PATCH",
          body: {
            nom: form.nom,
            prenom: form.prenom,
            email: form.email,
            poste: form.poste,
            departmentId: form.departmentId || null,
            managerId: form.managerId || null,
            ...(!sameBusinessRoles(selectedRoles, editing.roles ?? [])
              ? { roles: rolePayload }
              : {}),
          },
        });
        toast.success("Utilisateur mis à jour");
      } else {
        await apiFetch(`/admin/users`, {
          method: "POST",
          body: {
            matricule: form.matricule,
            nom: form.nom,
            prenom: form.prenom,
            email: form.email,
            poste: form.poste,
            sexe: form.sexe,
            roles: rolePayload,
            departmentId: form.departmentId || undefined,
            managerId: form.managerId || undefined,
          },
        });
        toast.success("Utilisateur créé");
      }
      setDlgOpen(false);
      await refreshUsers();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
  };

  const exportUsers = () => {
    if (filteredRows.length === 0) {
      toast.info("Aucun employé à télécharger");
      return;
    }

    exportEmployeesCsv(filteredRows);
    toast.success(`${filteredRows.length} employé(s) téléchargé(s)`);
  };

  const importEmployees = async (employees: EmployeeCreatePayload[]) => {
    const result = await apiFetch<ImportEmployeesResponse>("/admin/users/import", {
      method: "POST",
      body: { employees },
    });

    await refreshUsers();
    toast.success(`${result.created} employé(s) créé(s)`, {
      description: result.updated > 0 ? `${result.updated} employé(s) mis à jour` : undefined,
    });
  };

  return (
    <AppShell title="Gestion du personnel (Admin)">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un employé…"
              className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleBulkRemove}
              disabled={selectedCount === 0}
            >
              <Trash2 className="size-4" /> Supprimer ({selectedCount})
            </Button>
            <Button variant="outline" onClick={exportUsers}>
              <Download className="size-4" /> Télécharger
            </Button>
            <ImportEmployeesButton onImport={importEmployees} />
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Ajouter un employé
            </Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  aria-label="Sélectionner tous les employés filtrés"
                />
              </th>
              <th className="px-5 py-3">Nom complet</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Rôle</th>
              <th className="px-5 py-3">Département</th>
              <th className="px-5 py-3">Manager</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-muted-foreground">
                  Chargement...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-destructive">
                  Erreur: {error}
                </td>
              </tr>
            )}
            {!loading && !error && filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-muted-foreground">
                  Aucun employé ne correspond à la recherche.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              filteredRows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleSelected(r.id)}
                      aria-label={`Sélectionner ${r.n}`}
                    />
                  </td>
                  <td className="px-5 py-3 font-medium">{r.n}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.e}</td>
                  <td className="px-5 py-3">{r.r}</td>
                  <td className="px-5 py-3">{r.d}</td>
                  <td className="px-5 py-3">{r.m}</td>
                  <td className="px-5 py-3">
                    <Badge
                      tone={
                        r.status === "INACTIVE"
                          ? "rejected"
                          : r.status === "ON_LEAVE"
                            ? "pending"
                            : "valid"
                      }
                    >
                      {STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <RowActions
                      label={`l'employé ${r.n}`}
                      item={r as Record<string, unknown>}
                      fields={autoFields(r as Record<string, unknown>, FIELD_LABELS)}
                      onEdit={() => openEdit(r.id)}
                      onRemove={() => handleRemove(r.id)}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="flex justify-end p-4 border-t gap-1 text-sm">
          {[1, 2, 3].map((n, i) => (
            <button
              key={n}
              className={`size-8 rounded ${n === 1 ? "bg-navy text-navy-foreground" : "hover:bg-accent"}`}
            >
              {n}
            </button>
          ))}
          <button className="size-8 rounded hover:bg-accent">›</button>
        </div>
        <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
          <DialogContent className="sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Modifier employé" : "Créer employé"}</DialogTitle>
              <DialogDescription>
                {editing?.id
                  ? "Mettez à jour les informations puis enregistrez."
                  : "Renseignez les champs pour créer un employé."}
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitForm();
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Prénom</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.prenom}
                    onChange={(e) => setForm({ ...form, prenom: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Nom</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.nom}
                    onChange={(e) => setForm({ ...form, nom: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Email</span>
                  <input
                    type="email"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Matricule</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.matricule}
                    onChange={(e) => setForm({ ...form, matricule: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Poste</span>
                  <input
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.poste}
                    onChange={(e) => setForm({ ...form, poste: e.target.value })}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Sexe</span>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.sexe}
                    onChange={(e) => setForm({ ...form, sexe: e.target.value })}
                  >
                    <option value="M">Masculin</option>
                    <option value="F">Féminin</option>
                  </select>
                </label>
                <div className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Rôles</span>
                  <div className="grid gap-2 rounded-md border px-3 py-2 text-sm">
                    {ROLE_OPTIONS.map((role) => {
                      const checked = form.roles.includes(role.value);
                      return (
                        <label key={role.value} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                roles: event.target.checked
                                  ? normalizeBusinessRoles([...current.roles, role.value])
                                  : current.roles.filter((value) => value !== role.value),
                              }))
                            }
                          />
                          <span>{role.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Département</span>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  >
                    <option value="">-- Aucun --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">Manager (N+1)</span>
                  <select
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={form.managerId}
                    onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                  >
                    <option value="">-- Aucun --</option>
                    {managers
                      .filter((m) => m.id !== editing?.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="p-4 flex justify-end">
                <Button type="button" variant="outline" onClick={() => setDlgOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" className="ml-2">
                  Enregistrer
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
    </AppShell>
  );
}
