import { createFileRoute } from "@tanstack/react-router";
import { RhPermissionsPage } from "@/modules/shared/permissions/permissions.page";

export const Route = createFileRoute("/rh/permissions")({
  component: RhPermissionsPage,
  head: () => ({ meta: [{ title: "Permissions · RH" }] }),
});
