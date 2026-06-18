import { createFileRoute } from "@tanstack/react-router";
import { ManagerConflits } from "@/modules/manager/conflicts/conflicts.page";

export const Route = createFileRoute("/manager/conflits")({
  component: ManagerConflits,
  head: () => ({ meta: [{ title: "Conflits d'absence · Manager" }] }),
});
