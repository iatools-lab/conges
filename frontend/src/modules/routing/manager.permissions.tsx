import { createFileRoute } from "@tanstack/react-router";
import { ManagerPermissionsPage } from "@/modules/shared/permissions/permissions.page";

export const Route = createFileRoute("/manager/permissions")({
  component: ManagerPermissionsPage,
  head: () => ({ meta: [{ title: "Permissions · Manager" }] }),
});
