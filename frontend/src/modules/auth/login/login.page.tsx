import { useRouter } from "@tanstack/react-router";
import { Mail, Palmtree } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { AUTH_GOOGLE_ONLY } from "@/modules/auth/config";
import { getAuthSession, saveAuthSession, type AuthSession } from "@/modules/auth/session";

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_BUTTON_ID = "google-signin-button";

type GoogleCredentialResponse = {
  credential?: string;
};

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_SCRIPT_SRC}"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google unavailable")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google unavailable"));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.79-.07-1.55-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.52Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.51c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.89a6.01 6.01 0 0 1 0-3.78V7.52H3.07a10 10 0 0 0 0 8.96l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.99c1.47 0 2.78.5 3.82 1.49l2.87-2.87C16.95 2.99 14.7 2 12 2a10 10 0 0 0-8.93 5.52l3.34 2.59C7.2 7.75 9.4 5.99 12 5.99Z"
      />
    </svg>
  );
}

export function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const session = getAuthSession();
    if (session) window.location.assign(session.homePath);
  }, []);

  useEffect(() => {
    let isDisposed = false;

    async function mountGoogleButton() {
      if (!GOOGLE_CLIENT_ID) {
        if (AUTH_GOOGLE_ONLY) setError("Connexion Google indisponible");
        return;
      }

      try {
        await loadGoogleIdentityScript();
        if (isDisposed || !window.google?.accounts?.id) return;

        const buttonContainer = document.getElementById(GOOGLE_BUTTON_ID);
        if (!buttonContainer) return;

        buttonContainer.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: GoogleCredentialResponse) => {
            if (!response.credential) {
              setError("Connexion Google impossible");
              return;
            }
            void loginWithGoogle(response.credential);
          },
        });
        window.google.accounts.id.renderButton(buttonContainer, {
          theme: "outline",
          size: "large",
          type: "standard",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: 320,
        });
      } catch {
        if (!isDisposed) setError("Connexion Google indisponible");
      }
    }

    async function loginWithGoogle(credential: string) {
      setError(null);
      setIsSubmitting(true);

      try {
        const session = await apiFetch<AuthSession>("/auth/google", {
          method: "POST",
          body: JSON.stringify({ credential, clientId: GOOGLE_CLIENT_ID }),
        });
        saveAuthSession(session);
        toast.success(`Bienvenue ${session.name}`);
        window.location.assign(session.homePath);
      } catch (loginError) {
        const message =
          loginError instanceof Error ? loginError.message : "Connexion Google impossible";
        setError(message);
        toast.error(message);
      } finally {
        setIsSubmitting(false);
        void router.invalidate();
      }
    }

    void mountGoogleButton();

    return () => {
      isDisposed = true;
    };
  }, [router]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const session = await apiFetch<AuthSession>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
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
      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-12 items-center">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-6">
            <div className="size-10 rounded-lg bg-navy text-navy-foreground flex items-center justify-center font-bold">
              C
            </div>
            <div>
              <div className="font-semibold">Conges upOwa</div>
              <div className="text-xs text-muted-foreground">Gestion des Congés</div>
            </div>
          </div>
          <div className="size-64 rounded-full bg-stat-blue flex items-center justify-center">
            <Palmtree className="size-32 text-stat-blue-fg" />
          </div>
        </div>
        <div className="bg-card border rounded-xl p-8 shadow-sm">
          <h2 className="text-xl font-semibold mb-6">Connexion à votre compte</h2>
          {!AUTH_GOOGLE_ONLY && (
            <form className="space-y-4" onSubmit={submit}>
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium mb-1.5">
                  Email professionnel
                </label>
                <div className="relative">
                  <input
                    id="login-email"
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
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-sm font-medium">
                    Mot de passe
                  </label>
                  <button
                    type="button"
                    onClick={() => router.navigate({ to: "/forgot-password" })}
                    className="text-xs text-navy hover:underline"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Votre mot de passe"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-navy text-navy-foreground py-2.5 text-sm font-medium hover:bg-navy-hover disabled:opacity-60"
              >
                {isSubmitting ? "Connexion..." : "Se connecter"}
              </button>
            </form>
          )}
          {error && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {!AUTH_GOOGLE_ONLY && (
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>ou</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          <div
            id={GOOGLE_BUTTON_ID}
            className={`flex min-h-10 justify-center ${AUTH_GOOGLE_ONLY ? "mt-6" : ""}`}
          >
            <button
              type="button"
              disabled
              className="flex h-10 w-full max-w-80 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground"
            >
              <GoogleIcon />
              Continuer avec Google
            </button>
          </div>
          {!AUTH_GOOGLE_ONLY && (
            <div className="mt-6 text-center text-sm text-muted-foreground">
              Pas encore de compte ?{" "}
              <button
                type="button"
                onClick={() => router.navigate({ to: "/signup" })}
                className="text-navy hover:underline font-medium"
              >
                Créer un compte
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="absolute bottom-4 text-xs text-muted-foreground">
        {" "}
        © 2026 Conges upOwa · Tous droits réservés
      </div>
    </div>
  );
}
