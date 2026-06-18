import { createFileRoute } from "@tanstack/react-router";
import { ManagerHistorique } from "@/modules/manager/history/history.page";

export const Route = createFileRoute("/manager/historique")({
  component: ManagerHistorique,
  head: () => ({ meta: [{ title: "Historique validations · Manager" }] }),
});
