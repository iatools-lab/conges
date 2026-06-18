import type { FrontendModule } from "../module.types";

export const adminModule: FrontendModule = {
  id: "admin",
  label: "Administration",
  basePath: "/admin",
  submodules: [
    { id: "users", label: "Employés", path: "/admin/users" },
    { id: "roles", label: "Rôles & permissions", path: "/admin/roles" },
    { id: "departments", label: "Départements", path: "/admin/departements" },
    { id: "workflows", label: "Workflows", path: "/admin/workflows" },
    { id: "holidays", label: "Jours fériés", path: "/admin/feries" },
    { id: "settings", label: "Paramètres système", path: "/admin/parametres" },
    { id: "logs", label: "Logs", path: "/admin/logs" },
  ],
};
