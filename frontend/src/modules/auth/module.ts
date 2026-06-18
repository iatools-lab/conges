import type { FrontendModule } from "../module.types";

export const authModule: FrontendModule = {
  id: "public",
  label: "Accès public",
  basePath: "/",
  submodules: [
    { id: "landing", label: "Accueil", path: "/landing" },
    { id: "login", label: "Connexion", path: "/login" },
  ],
};
