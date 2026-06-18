import { createFileRoute } from "@tanstack/react-router";
import { Workflows } from "@/modules/admin/workflows/workflows.page";

export const Route = createFileRoute("/admin/workflows")({
  component: Workflows,
  head: () => ({ meta: [{ title: "Workflows · Conges upOwa" }] }),
});
