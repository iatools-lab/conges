import { createFileRoute } from "@tanstack/react-router";
import { ManagerPlanning } from "@/modules/manager/planning/planning.page";

export const Route = createFileRoute("/manager/planning")({
  component: ManagerPlanning,
  head: () => ({ meta: [{ title: "Planning équipe · Manager" }] }),
});
