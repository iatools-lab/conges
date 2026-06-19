import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { ResetPassword } from "@/modules/auth/reset-password/reset-password.page";

export const Route = createFileRoute("/reset-password")({
  beforeLoad: () => {
    if (AUTH_GOOGLE_ONLY) throw redirect({ to: "/login" });
  },
  component: ResetPassword,
  head: () => ({ meta: [{ title: "Nouveau mot de passe · Conges upOwa" }] }),
});
