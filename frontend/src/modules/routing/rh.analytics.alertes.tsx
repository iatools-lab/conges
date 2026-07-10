import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsAlertsPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/alertes")({
  component: RhAnalyticsAlertsPage,
  head: () => ({ meta: [{ title: "Conflits et alertes RH · Conges upOwa" }] }),
});
