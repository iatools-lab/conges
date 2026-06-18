import { createFileRoute } from "@tanstack/react-router";
import { ForgotPassword } from "@/modules/auth/forgot-password/forgot-password.page";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
  head: () => ({ meta: [{ title: "Mot de passe oublié · Conges upOwa" }] }),
});