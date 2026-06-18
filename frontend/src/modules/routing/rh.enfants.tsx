import { createFileRoute } from "@tanstack/react-router";
import { Enfants } from "@/modules/rh/children/children.page";

export const Route = createFileRoute("/rh/enfants")({
  component: Enfants,
  head: () => ({ meta: [{ title: "Gestion des enfants · Conges upOwa" }] }),
});
