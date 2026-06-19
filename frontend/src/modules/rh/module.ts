import type { FrontendModule } from "../module.types";

export const rhModule: FrontendModule = {
  id: "rh",
  label: "Ressources Humaines",
  basePath: "/rh",
  submodules: [
    { id: "dashboard", label: "Tableau de bord RH", path: "/rh" },
    { id: "leave-requests", label: "Demande & Planification", path: "/rh/demandes-conges" },
    { id: "global-view", label: "Vue globale congés", path: "/rh/global" },
    { id: "alerts", label: "Alertes conformité", path: "/rh/alertes" },
    { id: "employees", label: "Employés", path: "/rh/employes" },
    { id: "hierarchy", label: "Hiérarchie", path: "/rh/hierarchie" },
    { id: "children", label: "Enfants", path: "/rh/enfants" },
    { id: "special-leaves", label: "Congés spéciaux", path: "/rh/speciaux" },
    { id: "leave-balances", label: "Soldes CP", path: "/rh/soldes-cp" },
    { id: "leave-liabilities", label: "Passif", path: "/rh/passif" },
    { id: "holidays", label: "Jours fériés", path: "/rh/feries" },
    { id: "exports", label: "Exports", path: "/rh/exports" },
    { id: "audit", label: "Audit", path: "/rh/audit" },
    { id: "settings", label: "Paramètres RH", path: "/rh/parametres" },
  ],
};
