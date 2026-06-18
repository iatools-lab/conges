import type { FrontendModule } from "../module.types";

export const managerModule: FrontendModule = {
  id: "manager",
  label: "Manager",
  basePath: "/manager",
  submodules: [
    { id: "dashboard", label: "Dashboard pilotage", path: "/manager" },
    { id: "requests", label: "Demandes & Validations", path: "/manager/demandes" },
    { id: "conflicts", label: "Conflits", path: "/manager/conflits" },
    { id: "calendar", label: "Planning équipe", path: "/manager/planning" },
    { id: "history", label: "Historique validations", path: "/manager/historique" },
  ],
};
