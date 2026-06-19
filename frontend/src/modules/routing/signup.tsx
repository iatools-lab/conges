import { createFileRoute, redirect } from "@tanstack/react-router";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { Signup } from "@/modules/auth/signup/signup.page";

export const Route = createFileRoute("/signup")({
  beforeLoad: () => {
    if (AUTH_GOOGLE_ONLY) throw redirect({ to: "/login" });
  },
  component: Signup,
  head: () => ({ meta: [{ title: "Inscription · Conges upOwa" }] }),
});
