import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, Button, Badge } from "@/components/ui-kit";
import { Plus, Building2, Search } from "lucide-react";
import { RowActions, autoFields } from "@/components/RowActions";
import { apiFetch } from "@/lib/api";

type DeptRow = {
  id: string;
  code?: string;
  name: string;
  manager?: string;
  count?: number;
  parent?: string;
};
type DepartmentApiRow = {
  id: string;
  code?: string;
  name?: string;
  manager?: { prenom?: string; nom?: string } | null;
  count?: number;
  parentName?: string | null;
};
type UserApiRow = {
  department?: {
    id?: string;
    code?: string;
    name?: string;
    manager?: { prenom?: string; nom?: string } | null;
    parentName?: string | null;
  } | null;
};

const initial_deps: DeptRow[] = [];

const FIELD_LABELS = {
  code: "Code",
  name: "Nom",
  manager: "Manager",
  count: "Effectif",
  parent: "Parent",
};

export function Departements() {
  const [deps, setDeps] = useState<DeptRow[]>(initial_deps);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      apiFetch<{ rows: DepartmentApiRow[] }>("/admin/departments"),
      apiFetch<{ rows: UserApiRow[] }>("/admin/users"),
    ])
      .then(([deptRes, userRes]) => {
        if (!mounted) return;

        const users = userRes.rows ?? [];
        const groupedFromUsers = new Map<
          string,
          {
            id: string;
            code?: string;
            name: string;
            manager?: string;
            count: number;
            parent?: string;
          }
        >();

        users.forEach((u) => {
          const dept = u.department;
          if (!dept?.name) return;
          const key = String(dept.name).trim().toLowerCase();
          const current = groupedFromUsers.get(key);
          if (current) {
            current.count += 1;
            return;
          }
          groupedFromUsers.set(key, {
            id: dept.id ?? `derived-${key}`,
            code: dept.code,
            name: dept.name,
            manager: dept.manager
              ? `${dept.manager.prenom ?? ""} ${dept.manager.nom ?? ""}`.trim()
              : "—",
            count: 1,
            parent: dept.parentName ?? "—",
          });
        });

        const mappedFromDepartments = (deptRes.rows ?? []).map((d) => {
          const key = String(d.name ?? "")
            .trim()
            .toLowerCase();
          const fromUsers = groupedFromUsers.get(key);
          return {
            id: d.id,
            code: d.code,
            name: d.name,
            manager: d.manager
              ? `${d.manager.prenom ?? ""} ${d.manager.nom ?? ""}`.trim()
              : (fromUsers?.manager ?? "—"),
            count: fromUsers?.count ?? d.count ?? 0,
            parent: d.parentName ?? "—",
          } as DeptRow;
        });

        const shouldUseDerived = mappedFromDepartments.length === 0;
        const derived = Array.from(groupedFromUsers.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );

        setDeps(shouldUseDerived ? derived : mappedFromDepartments);
      })
      .catch((err) => setError(err.message ?? String(err)))
      .finally(() => setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  const filteredDeps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return deps;

    return deps.filter((department) =>
      [department.code, department.name, department.manager, department.parent, department.count]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [deps, query]);

  return (
    <AppShell title="Départements" subtitle="Structure organisationnelle de l'entreprise">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Total départements</div>
          <div className="text-3xl font-bold mt-2">{deps.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Effectif total</div>
          <div className="text-3xl font-bold mt-2">
            {deps.reduce((sum, d) => sum + (d.count ?? 0), 0)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Managers actifs</div>
          <div className="text-3xl font-bold mt-2">
            {deps.filter((d) => d.manager && d.manager !== "—").length}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Sous-départements</div>
          <div className="text-3xl font-bold mt-2">
            {deps.filter((d) => d.parent && d.parent !== "—").length}
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex flex-col gap-3 p-4 border-b sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-semibold">Liste des départements</h3>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher un département..."
                className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <Button>
              <Plus className="size-4" />
              Nouveau département
            </Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Nom</th>
              <th className="px-5 py-3">Manager</th>
              <th className="px-5 py-3">Effectif</th>
              <th className="px-5 py-3">Département parent</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                  Chargement...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-destructive">
                  Erreur: {error}
                </td>
              </tr>
            )}
            {!loading && !error && filteredDeps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                  Aucun département ne correspond à la recherche.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              filteredDeps.map((d) => (
                <tr key={d.code}>
                  <td className="px-5 py-3">
                    <Badge tone="info">{d.code}</Badge>
                  </td>
                  <td className="px-5 py-3 font-medium flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    {d.name}
                  </td>
                  <td className="px-5 py-3">{d.manager}</td>
                  <td className="px-5 py-3">{d.count}</td>
                  <td className="px-5 py-3 text-muted-foreground">{d.parent}</td>
                  <td className="px-5 py-3 text-right">
                    <RowActions
                      label={`le département ${d.name}`}
                      item={d as Record<string, unknown>}
                      fields={autoFields(d as Record<string, unknown>, FIELD_LABELS)}
                      onSave={(n) =>
                        setDeps((rs) => rs.map((x) => (x.id === d.id ? (n as typeof x) : x)))
                      }
                      onRemove={() => setDeps((rs) => rs.filter((x) => x.id !== d.id))}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </AppShell>
  );
}
