import { createFileRoute } from "@tanstack/react-router";
import { Parametres } from "@/modules/admin/settings/settings.page";

export const Route = createFileRoute("/admin/parametres")({
  component: Parametres,
  head: () => ({ meta: [{ title: "Paramètres RH · Conges upOwa" }] }),
});
