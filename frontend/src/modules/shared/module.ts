import type { FrontendModule } from "../module.types";

export const sharedModule: FrontendModule = {
  id: "shared",
  label: "Transverse",
  basePath: "/",
  submodules: [
    { id: "departments", label: "Départements", path: "/admin/departements" },
    { id: "leave-types", label: "Types de congés", path: "/rh/parametres" },
    { id: "notifications", label: "Notifications", path: "/" },
  ],
};
