import { createFileRoute } from "@tanstack/react-router";
import { ManagerCalendrier } from "@/modules/manager/calendar/calendar.page";

export const Route = createFileRoute("/manager/calendrier")({
  component: ManagerCalendrier,
  head: () => ({ meta: [{ title: "Calendrier équipe · Manager" }] }),
});
