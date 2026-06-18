import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Mail, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

export function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await apiFetch<{ message: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setIsSent(true);
      toast.success("Code envoyé si l'email existe");
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Erreur lors de l'envoi";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md bg-card border rounded-xl p-8 shadow-sm text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-100">
            <Mail className="size-7 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Email envoyé</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Si un compte existe avec cette adresse, un code à 6 chiffres vous a été envoyé. Il
            expire dans 5 minutes.
          </p>
          <button
            type="button"
            onClick={() => router.navigate({ to: "/verify-otp", search: { email } })}
            className="w-full rounded-md bg-navy text-navy-foreground py-2.5 text-sm font-medium hover:bg-navy-hover mb-3"
          >
            J'ai un code, vérifier
          </button>
          <button
            type="button"
            onClick={() => setIsSent(false)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Envoyer à nouveau
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md bg-card border rounded-xl p-8 shadow-sm">
        <button
          type="button"
          onClick={() => router.navigate({ to: "/login" })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="size-4" />
          Retour à la connexion
        </button>

        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-100">
          <ShieldAlert className="size-6 text-amber-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Mot de passe oublié</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Saisissez votre email professionnel. Un code de vérification à 6 chiffres vous sera
          envoyé.
        </p>

        <form className="space-y-4" onSubmit={submit}>
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium mb-1.5">
              Email professionnel
            </label>
            <div className="relative">
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="votre.email@upowa.org"
                required
                autoFocus
                autoComplete="email"
                className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
              />
              <Mail className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-navy text-navy-foreground py-2.5 text-sm font-medium hover:bg-navy-hover disabled:opacity-60"
          >
            {isSubmitting ? "Envoi..." : "Envoyer le code"}
          </button>
        </form>
      </div>
    </div>
  );
}
