import { createFileRoute } from "@tanstack/react-router";
import { RhDemandesConges } from "@/modules/rh/leave-requests/leave-requests.page";

export const Route = createFileRoute("/rh/demandes-conges")({
  component: RhDemandesConges,
  head: () => ({ meta: [{ title: "Demande & Planification · RH" }] }),
});
