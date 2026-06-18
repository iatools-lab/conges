import { createFileRoute } from "@tanstack/react-router";
import { RhAudit } from "@/modules/rh/audit/audit.page";

export const Route = createFileRoute("/rh/audit")({
  component: RhAudit,
  head: () => ({ meta: [{ title: "Audit · RH" }] }),
});
