import { createFileRoute } from "@tanstack/react-router";
import { Declarer } from "@/modules/employee/events/events.page";

export const Route = createFileRoute("/declarer")({
  component: Declarer,
  head: () => ({ meta: [{ title: "Déclarer un événement · Conges upOwa" }] }),
});
