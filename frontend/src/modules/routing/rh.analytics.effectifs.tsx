import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsWorkforcePage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/effectifs")({
  component: RhAnalyticsWorkforcePage,
  head: () => ({ meta: [{ title: "Analyse des effectifs · Conges upOwa" }] }),
});
