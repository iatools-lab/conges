import { createFileRoute } from "@tanstack/react-router";
import { RhAlertes } from "@/modules/rh/alerts/alerts.page";

export const Route = createFileRoute("/rh/alertes")({
  component: RhAlertes,
  head: () => ({ meta: [{ title: "Alertes conformité · RH" }] }),
});
