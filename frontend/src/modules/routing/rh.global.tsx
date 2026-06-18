import { createFileRoute } from "@tanstack/react-router";
import { VueGlobale } from "@/modules/rh/global-view/global-view.page";

export const Route = createFileRoute("/rh/global")({
  component: VueGlobale,
  head: () => ({ meta: [{ title: "Vue globale des congés · Conges upOwa" }] }),
});
