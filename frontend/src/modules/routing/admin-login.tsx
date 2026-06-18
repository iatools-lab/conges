import { createFileRoute } from "@tanstack/react-router";
import { AdminLogin } from "@/modules/auth/admin-login/admin-login.page";

export const Route = createFileRoute("/admin-login")({
  component: AdminLogin,
  head: () => ({ meta: [{ title: "Administrateur · Conges upOwa" }] }),
});