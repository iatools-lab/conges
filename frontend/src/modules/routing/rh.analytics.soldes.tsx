import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsBalancesPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/soldes")({
  component: RhAnalyticsBalancesPage,
  head: () => ({ meta: [{ title: "Soldes et droits · Conges upOwa" }] }),
});
