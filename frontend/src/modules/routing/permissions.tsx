import { createFileRoute } from "@tanstack/react-router";
import { EmployeePermissionsPage } from "@/modules/shared/permissions/permissions.page";

export const Route = createFileRoute("/permissions")({
  component: EmployeePermissionsPage,
  head: () => ({ meta: [{ title: "Permissions · Conges upOwa" }] }),
});
