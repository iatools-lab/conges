import { useRouter } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { saveAuthSession, type AuthSession } from "@/modules/auth/session";

export function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const session = await apiFetch<AuthSession>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: "admin@upowa.org",
          password,
        }),
      });
      saveAuthSession(session);
      toast.success(`Bienvenue ${session.name}`);
      window.location.assign(session.homePath);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Connexion impossible";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
      void router.invalidate();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="size-10 rounded-lg bg-navy text-navy-foreground flex items-center justify-center font-bold">
            C
          </div>
          <div>
            <div className="font-semibold text-center">Conges upOwa</div>
            <div className="text-xs text-muted-foreground">Administrateur système</div>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-8 shadow-sm">
          <h2 className="text-xl font-semibold mb-6">Connexion super administrateur</h2>
          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="admin-email" className="block text-sm font-medium mb-1.5">
                Email
              </label>
              <input
                id="admin-email"
                type="email"
                value="admin@upowa.org"
                readOnly
                className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-sm font-medium mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe administrateur"
                  required
                  autoFocus
                  autoComplete="current-password"
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
                />
                <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
              {isSubmitting ? "Connexion..." : "Se connecter"}
            </button>
          </form>
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => router.navigate({ to: "/login" })}
              className="text-navy hover:underline font-medium"
            >
              Retour à la connexion employé
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}