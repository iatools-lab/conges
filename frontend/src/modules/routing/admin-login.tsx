import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { AdminLogin } from "@/modules/auth/admin-login/admin-login.page";

export const Route = createFileRoute("/admin-login")({
  beforeLoad: () => {
    if (AUTH_GOOGLE_ONLY) throw redirect({ to: "/login" });
  },
  component: AdminLogin,
  head: () => ({ meta: [{ title: "Administrateur · Conges upOwa" }] }),
});
