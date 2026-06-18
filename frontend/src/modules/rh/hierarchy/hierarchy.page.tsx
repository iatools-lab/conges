import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, StatCard } from "@/components/ui-kit";
import { apiFetch } from "@/lib/api";
import { Building2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

type ApiRole = { role: string };

type ApiUser = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  poste?: string | null;
  departmentId: string | null;
  n1Id: string | null;
  n2Id: string | null;
  n3Id: string | null;
  department?: { id: string; name: string } | null;
  roles: ApiRole[];
};

type ApiDepartment = {
  id: string;
  name: string;
  managerId?: string | null;
  manager?: {
    id: string;
    nom?: string;
    prenom?: string;
    email?: string;
  } | null;
};

type ApiUsersResponse = { rows: ApiUser[] };
type ApiDepartmentsResponse = { rows: ApiDepartment[] };
type ApiRolesResponse = { rows: Array<{ id: string; role: string }> };

const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const emptyUsers: ApiUser[] = [];
const emptyDepartments: ApiDepartment[] = [];

const UPOWA_DEPARTMENTS = [
  "Direction Generale",
  "Commercial",
  "Operations et Supply Chain",
  "Infrastructure",
  "Ressources Humaines",
  "Recherche et Developement",
  "Finances",
  "QHSE",
  "Systeme Information",
] as const;

function normalizeLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function getUserLabel(user?: ApiUser | null) {
  if (!user) return "Non defini";
  const name = `${user.prenom ?? ""} ${user.nom ?? ""}`.trim();
  return name || user.email || user.id;
}

function isDirectorGeneral(user: ApiUser) {
  const normalizedPoste = normalizeLabel(user.poste ?? "");
  return normalizedPoste.includes("directeurgeneral");
}

export function RhHierarchy() {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"departements" | "affectations">("departements");
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState("");
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [departmentHeads, setDepartmentHeads] = useState<Record<string, string>>({});
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<string, { n1Id: string; n2Id: string; n3Id: string }>
  >({});

  const usersQuery = useQuery({
    queryKey: ["admin-users", "hierarchy"],
    queryFn: () => apiFetch<ApiUsersResponse>("/admin/users?limit=500"),
  });

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments", "hierarchy"],
    queryFn: () => apiFetch<ApiDepartmentsResponse>("/admin/departments"),
  });

  const users = usersQuery.data?.rows ?? emptyUsers;
  const departments = departmentsQuery.data?.rows ?? emptyDepartments;

  const usersById = useMemo(() => {
    return new Map(users.map((user) => [user.id, user]));
  }, [users]);

  const managers = useMemo(
    () => users.filter((user) => user.roles.some((role) => role.role === "MANAGER")),
    [users],
  );

  const assignmentCandidates = useMemo(() => users, [users]);

  const companyDepartments = useMemo(() => {
    const byNormalized = new Map(
      departments.map((department) => [normalizeLabel(department.name), department]),
    );

    return UPOWA_DEPARTMENTS.map((expectedName) => {
      const found = byNormalized.get(normalizeLabel(expectedName));
      return {
        expectedName,
        department: found,
      };
    });
  }, [departments]);

  const directorGeneralId = useMemo(() => {
    const directionLine = companyDepartments.find(
      (line) => normalizeLabel(line.expectedName) === normalizeLabel("Direction Generale"),
    );
    if (directionLine?.department?.managerId) return directionLine.department.managerId;

    const byPoste = users.find((user) => isDirectorGeneral(user));
    if (byPoste) return byPoste.id;

    const byDepartment = users.find(
      (user) =>
        normalizeLabel(user.department?.name ?? "") === normalizeLabel("Direction Generale") &&
        user.roles.some((role) => role.role === "MANAGER"),
    );
    return byDepartment?.id ?? "";
  }, [companyDepartments, users]);

  const departmentHeadIds = useMemo(() => {
    const ids = new Set<string>();
    companyDepartments.forEach((line) => {
      const selected = departmentHeads[line.expectedName];
      if (selected) ids.add(selected);
      if (line.department?.managerId) ids.add(line.department.managerId);
      if (line.department?.manager?.id) ids.add(line.department.manager.id);
    });
    return ids;
  }, [companyDepartments, departmentHeads]);

  useEffect(() => {
    if (users.length === 0) {
      setAssignmentDrafts({});
      return;
    }

    const next: Record<string, { n1Id: string; n2Id: string; n3Id: string }> = {};
    users.forEach((user) => {
      next[user.id] = {
        n1Id: user.n1Id ?? "",
        n2Id: user.n2Id ?? "",
        n3Id: user.n3Id ?? "",
      };
    });
    setAssignmentDrafts(next);
  }, [users]);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-departments"] });
    void queryClient.invalidateQueries({ queryKey: ["account-profile"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-global-view"] });
    void queryClient.invalidateQueries({ queryKey: ["rh-dashboard"] });
  };

  const ensureManagerRole = async (userId: string) => {
    const roleRows = await apiFetch<ApiRolesResponse>(
      `/admin/roles?userId=${encodeURIComponent(userId)}`,
    );
    const hasManager = roleRows.rows.some((row) => row.role === "MANAGER");
    if (!hasManager) {
      await apiFetch("/admin/roles", {
        method: "POST",
        body: JSON.stringify({ userId, role: "MANAGER" }),
      });
    }
  };

  const updateUserMutation = useMutation({
    mutationFn: (payload: {
      userId: string;
      managerId?: string | null;
      n1Id?: string | null;
      n2Id?: string | null;
      n3Id?: string | null;
    }) =>
      apiFetch(`/admin/users/${payload.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(payload.managerId !== undefined ? { managerId: payload.managerId } : {}),
          ...(payload.n1Id !== undefined ? { n1Id: payload.n1Id } : {}),
          ...(payload.n2Id !== undefined ? { n2Id: payload.n2Id } : {}),
          ...(payload.n3Id !== undefined ? { n3Id: payload.n3Id } : {}),
        }),
      }),
  });

  const updateDepartmentMutation = useMutation({
    mutationFn: (payload: { departmentId: string; managerId: string }) =>
      apiFetch(`/admin/departments/${payload.departmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ managerId: payload.managerId }),
      }),
  });

  const isBusy =
    usersQuery.isLoading ||
    departmentsQuery.isLoading ||
    updateUserMutation.isPending ||
    updateDepartmentMutation.isPending;

  const saveRowHierarchy = async (userId: string) => {
    const draft = assignmentDrafts[userId] ?? { n1Id: "", n2Id: "", n3Id: "" };
    const isDepartmentHead = departmentHeadIds.has(userId);

    let n1Id = draft.n1Id;
    const n2Id = draft.n2Id;
    const n3Id = draft.n3Id;

    if (isDepartmentHead && directorGeneralId && userId !== directorGeneralId) {
      n1Id = directorGeneralId;
    }

    const selectedIds = [n1Id, n2Id, n3Id].filter(Boolean);
    const unique = new Set(selectedIds);
    if (unique.size !== selectedIds.length) {
      toast.error("N+1, N+2 et N+3 doivent etre des personnes differentes");
      return;
    }

    if (selectedIds.includes(userId)) {
      toast.error("Un employe ne peut pas apparaitre dans sa propre chaine");
      return;
    }

    try {
      for (const supervisorId of selectedIds) {
        await ensureManagerRole(supervisorId);
      }

      await updateUserMutation.mutateAsync({
        userId,
        n1Id: n1Id || null,
        n2Id: n2Id || null,
        n3Id: n3Id || null,
      });

      toast.success("Hierarchie enregistree");
      refreshAll();
    } catch (error) {
      toast.error("Impossible d'enregistrer la hierarchie", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  const saveDepartmentHead = async (expectedDepartmentName: string) => {
    const line = companyDepartments.find((item) => item.expectedName === expectedDepartmentName);
    if (!line?.department) {
      toast.error(`Departement absent dans la base: ${expectedDepartmentName}`);
      return;
    }

    const managerId = departmentHeads[expectedDepartmentName] || line.department.managerId || "";
    if (!managerId) {
      toast.error("Selectionnez un chef de departement");
      return;
    }

    try {
      await updateDepartmentMutation.mutateAsync({
        departmentId: line.department.id,
        managerId,
      });

      if (directorGeneralId && managerId !== directorGeneralId) {
        await updateUserMutation.mutateAsync({
          userId: managerId,
          n1Id: directorGeneralId,
        });
      }

      await ensureManagerRole(managerId);
      toast.success(`Chef affecte pour ${expectedDepartmentName}`);
      refreshAll();
    } catch (error) {
      toast.error("Affectation impossible", {
        description: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  };

  const tableRows = useMemo(() => {
    const query = assignmentSearch.trim().toLowerCase();

    return [...users]
      .filter(
        (user) => !selectedDepartmentFilter || user.department?.name === selectedDepartmentFilter,
      )
      .filter((user) => {
        if (!query) return true;

        return [
          getUserLabel(user),
          user.email,
          user.department?.name ?? "",
          user.poste ?? "",
          ...user.roles.map((role) => role.role),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => getUserLabel(a).localeCompare(getUserLabel(b), "fr"));
  }, [assignmentSearch, selectedDepartmentFilter, users]);

  const assignmentDepartmentOptions = useMemo(
    () =>
      Array.from(new Set(users.map((user) => user.department?.name).filter(Boolean))).sort((a, b) =>
        String(a).localeCompare(String(b), "fr"),
      ),
    [users],
  );

  return (
    <AppShell
      title="Gouvernance RH"
      subtitle="upOwa - Chefs de departement et hierarchie N+1/N+2/N+3"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Departements upOwa" value={UPOWA_DEPARTMENTS.length} tone="blue" />
        <StatCard label="Managers disponibles" value={managers.length} tone="green" />
        <StatCard
          label="Departements relies"
          value={companyDepartments.filter((item) => item.department).length}
          tone="yellow"
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h3 className="font-semibold">Sous-menu Hierarchie</h3>
            <p className="text-sm text-muted-foreground">
              Departements: chefs de departement. Affectations: N+1/N+2/N+3 par employe.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={activeTab === "departements" ? "primary" : "outline"}
              onClick={() => setActiveTab("departements")}
              disabled={isBusy}
            >
              Departements
            </Button>
            <Button
              variant={activeTab === "affectations" ? "primary" : "outline"}
              onClick={() => setActiveTab("affectations")}
              disabled={isBusy}
            >
              Affectations
            </Button>
            <Button variant="outline" onClick={refreshAll} disabled={isBusy}>
              <RefreshCw className="size-4" /> Actualiser
            </Button>
          </div>
        </div>

        {activeTab === "departements" ? (
          <div className="divide-y">
            {companyDepartments.map((item) => {
              const currentHeadId =
                departmentHeads[item.expectedName] ||
                item.department?.managerId ||
                item.department?.manager?.id ||
                "";
              const currentHead = currentHeadId ? usersById.get(currentHeadId) : null;

              return (
                <div
                  key={item.expectedName}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[1.2fr_1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{item.expectedName}</div>
                    {item.department ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Nom BDD: {item.department.name}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-destructive">
                        Departement non present dans la base
                      </div>
                    )}
                    {item.expectedName !== "Direction Generale" && directorGeneralId ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Regle: N+1 du chef = Directeur General (
                        {getUserLabel(usersById.get(directorGeneralId))})
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <select
                      className={inputClass}
                      value={currentHeadId}
                      onChange={(event) =>
                        setDepartmentHeads((value) => ({
                          ...value,
                          [item.expectedName]: event.target.value,
                        }))
                      }
                      disabled={!item.department || isBusy}
                    >
                      <option value="">Selectionner un manager</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {getUserLabel(manager)}
                        </option>
                      ))}
                    </select>
                    {currentHead ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Actuel: {getUserLabel(currentHead)}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {item.department ? (
                      <Badge tone="valid">Relie</Badge>
                    ) : (
                      <Badge tone="rejected">Absent</Badge>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => saveDepartmentHead(item.expectedName)}
                      disabled={!item.department || isBusy}
                    >
                      <Building2 className="size-4" /> Affecter
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm"
                  placeholder="Rechercher employe, poste, role..."
                  value={assignmentSearch}
                  onChange={(event) => setAssignmentSearch(event.target.value)}
                  disabled={isBusy}
                />
              </div>
              <select
                className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedDepartmentFilter}
                onChange={(event) => setSelectedDepartmentFilter(event.target.value)}
                disabled={isBusy}
              >
                <option value="">Tous les departements</option>
                {assignmentDepartmentOptions.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Employe</th>
                  <th className="px-3 py-2">Departement</th>
                  <th className="px-3 py-2">Poste</th>
                  <th className="px-3 py-2">N+1</th>
                  <th className="px-3 py-2">N+2</th>
                  <th className="px-3 py-2">N+3</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tableRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      Aucun employe ne correspond a la recherche.
                    </td>
                  </tr>
                )}
                {tableRows.map((user) => {
                  const draft = assignmentDrafts[user.id] ?? { n1Id: "", n2Id: "", n3Id: "" };
                  const isDepartmentHead = departmentHeadIds.has(user.id);
                  const sameDepartmentCandidates = assignmentCandidates.filter(
                    (candidate) =>
                      candidate.departmentId &&
                      user.departmentId &&
                      candidate.departmentId === user.departmentId,
                  );
                  const forcedN1 =
                    isDepartmentHead && directorGeneralId && user.id !== directorGeneralId
                      ? directorGeneralId
                      : draft.n1Id;
                  const optionCandidates = (selectedId: string, excludedIds: string[] = []) => {
                    const candidatesById = new Map<string, ApiUser>();
                    sameDepartmentCandidates.forEach((candidate) => {
                      candidatesById.set(candidate.id, candidate);
                    });
                    const selected = selectedId ? usersById.get(selectedId) : null;
                    if (selected) candidatesById.set(selected.id, selected);

                    return Array.from(candidatesById.values())
                      .filter(
                        (candidate) =>
                          candidate.id !== user.id && !excludedIds.includes(candidate.id),
                      )
                      .sort((left, right) =>
                        getUserLabel(left).localeCompare(getUserLabel(right), "fr"),
                      );
                  };
                  const n1Options = optionCandidates(forcedN1);
                  const n2Options = optionCandidates(draft.n2Id, [forcedN1]);
                  const n3Options = optionCandidates(draft.n3Id, [forcedN1, draft.n2Id]);

                  const setDraft = (
                    next: Partial<{ n1Id: string; n2Id: string; n3Id: string }>,
                  ) => {
                    setAssignmentDrafts((value) => ({
                      ...value,
                      [user.id]: {
                        n1Id: next.n1Id ?? draft.n1Id,
                        n2Id: next.n2Id ?? draft.n2Id,
                        n3Id: next.n3Id ?? draft.n3Id,
                      },
                    }));
                  };

                  return (
                    <tr key={user.id}>
                      <td className="px-3 py-2 font-medium">{getUserLabel(user)}</td>
                      <td className="px-3 py-2">{user.department?.name ?? "Non affecte"}</td>
                      <td className="px-3 py-2">{user.poste ?? "-"}</td>
                      <td className="px-3 py-2">
                        <select
                          className={inputClass}
                          value={forcedN1}
                          disabled={isBusy || (isDepartmentHead && user.id !== directorGeneralId)}
                          onChange={(event) => setDraft({ n1Id: event.target.value })}
                        >
                          <option value="">Aucun</option>
                          {n1Options.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {getUserLabel(candidate)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={inputClass}
                          value={draft.n2Id}
                          disabled={isBusy}
                          onChange={(event) => setDraft({ n2Id: event.target.value })}
                        >
                          <option value="">Aucun</option>
                          {n2Options.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {getUserLabel(candidate)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={inputClass}
                          value={draft.n3Id}
                          disabled={isBusy}
                          onChange={(event) => setDraft({ n3Id: event.target.value })}
                        >
                          <option value="">Aucun</option>
                          {n3Options.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {getUserLabel(candidate)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="outline"
                          onClick={() => saveRowHierarchy(user.id)}
                          disabled={isBusy}
                        >
                          Enregistrer
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
