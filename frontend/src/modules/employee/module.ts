import type { FrontendModule } from "../module.types";

export const employeeModule: FrontendModule = {
  id: "employee",
  label: "Employé",
  basePath: "/",
  submodules: [
    { id: "dashboard", label: "Tableau de bord", path: "/" },
    { id: "balances", label: "Mon solde", path: "/solde" },
    { id: "planning", label: "Demandes et planification", path: "/planifier" },
    { id: "permissions", label: "Permissions", path: "/permissions" },
    { id: "leave-requests", label: "Calendrier équipe", path: "/demandes" },
    { id: "events", label: "Déclarer un événement", path: "/declarer" },
    { id: "history", label: "Historique", path: "/historique" },
  ],
};
