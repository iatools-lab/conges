import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsLeavesPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/conges")({
  component: RhAnalyticsLeavesPage,
  head: () => ({ meta: [{ title: "Analyse des congés · Conges upOwa" }] }),
});
