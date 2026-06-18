import { createFileRoute } from "@tanstack/react-router";
import { RhExports } from "@/modules/rh/exports/exports.page";

export const Route = createFileRoute("/rh/exports")({
  component: RhExports,
  head: () => ({ meta: [{ title: "Exports · RH" }] }),
});
