import { createFileRoute } from "@tanstack/react-router";
import { Planifier } from "@/modules/employee/planning/planning.page";

export const Route = createFileRoute("/planifier")({
  component: Planifier,
  head: () => ({ meta: [{ title: "Planifier mes congés · Conges upOwa" }] }),
});
