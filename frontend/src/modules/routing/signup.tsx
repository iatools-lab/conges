import { createFileRoute } from "@tanstack/react-router";
import { Signup } from "@/modules/auth/signup/signup.page";

export const Route = createFileRoute("/signup")({
  component: Signup,
  head: () => ({ meta: [{ title: "Inscription · Conges upOwa" }] }),
});