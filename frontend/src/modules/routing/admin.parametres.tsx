import { createFileRoute } from "@tanstack/react-router";
import { RhParametres } from "@/modules/rh/settings/settings.page";

export const Route = createFileRoute("/admin/parametres")({
  component: RhParametres,
  head: () => ({ meta: [{ title: "Paramètres RH · Conges upOwa" }] }),
});
