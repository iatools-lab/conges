import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/workflows")({
  component: () => null,
  head: () => ({ meta: [{ title: "Workflows · Conges upOwa" }] }),
});
