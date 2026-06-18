import { createFileRoute } from "@tanstack/react-router";
import { Logs } from "@/modules/admin/logs/logs.page";

export const Route = createFileRoute("/admin/logs")({
  component: Logs,
  head: () => ({ meta: [{ title: "Logs système · Conges upOwa" }] }),
});
