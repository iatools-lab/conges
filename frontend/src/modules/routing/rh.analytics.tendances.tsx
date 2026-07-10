import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsTrendsPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/tendances")({
  component: RhAnalyticsTrendsPage,
  head: () => ({ meta: [{ title: "Tendances RH · Conges upOwa" }] }),
});
