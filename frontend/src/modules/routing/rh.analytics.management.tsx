import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsManagementPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/management")({
  component: RhAnalyticsManagementPage,
  head: () => ({ meta: [{ title: "Analyse managériale · Conges upOwa" }] }),
});
