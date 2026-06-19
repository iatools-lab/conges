import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { ForgotPassword } from "@/modules/auth/forgot-password/forgot-password.page";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => {
    if (AUTH_GOOGLE_ONLY) throw redirect({ to: "/login" });
  },
  component: ForgotPassword,
  head: () => ({ meta: [{ title: "Mot de passe oublié · Conges upOwa" }] }),
});
