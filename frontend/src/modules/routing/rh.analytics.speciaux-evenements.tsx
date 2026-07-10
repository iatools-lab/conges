import { createFileRoute } from "@tanstack/react-router";
import { RhAnalyticsSpecialEventsPage } from "@/modules/rh/analytics/analytics.page";

export const Route = createFileRoute("/rh/analytics/speciaux-evenements")({
  component: RhAnalyticsSpecialEventsPage,
  head: () => ({ meta: [{ title: "Congés spéciaux et événements · Conges upOwa" }] }),
});
