import { createFileRoute } from "@tanstack/react-router";
import { HistoriquePage } from "@/modules/employee/history/history.page";

export const Route = createFileRoute("/historique")({
  component: HistoriquePage,
  head: () => ({ meta: [{ title: "Historique · Mes congés" }] }),
});
