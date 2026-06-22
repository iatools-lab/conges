import { useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { saveAuthSession, type AuthSession } from "@/modules/auth/session";

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_BUTTON_ID = "google-signin-button-signup";

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

export function Signup() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loginWithGoogle = useCallback(async (credential: string) => {
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
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Connexion Google impossible";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  useEffect(() => {
    let isDisposed = false;
    if (!GOOGLE_CLIENT_ID) return;

    loadGoogleIdentityScript()
      .then(() => {
        if (isDisposed) return;
        const buttonContainer = document.getElementById(GOOGLE_BUTTON_ID);
        if (!buttonContainer || !window.google?.accounts?.id) return;

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
      })
      .catch(() => {
        if (!isDisposed) setError("Connexion Google indisponible");
      });

    return () => {
      isDisposed = true;
    };
  }, [loginWithGoogle]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      setError(
        "Le mot de passe doit contenir au moins 8 caracteres, une majuscule, une minuscule et un chiffre.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const session = await apiFetch<AuthSession>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          confirmPassword,
        }),
      });
      saveAuthSession(session);
      toast.success(`Bienvenue ${session.name}`);
      window.location.assign(session.homePath);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Creation impossible";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="size-10 rounded-lg bg-navy text-navy-foreground flex items-center justify-center font-bold">
            C
          </div>
          <div>
            <div className="font-semibold text-center">Conges upOwa</div>
            <div className="text-xs text-muted-foreground">Creation de compte</div>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-8 shadow-sm">
          <h2 className="text-xl font-semibold mb-6">Creer votre mot de passe</h2>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label htmlFor="signup-email" className="block text-sm font-medium mb-1.5">
                Email professionnel
              </label>
              <div className="relative">
                <input
                  id="signup-email"
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
              <label htmlFor="signup-password" className="block text-sm font-medium mb-1.5">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Votre mot de passe"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="signup-confirm-password" className="block text-sm font-medium mb-1.5">
                Confirmer le mot de passe
              </label>
              <input
                id="signup-confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repetez le mot de passe"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
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
              {isSubmitting ? "Creation..." : "Creer mon mot de passe"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>ou</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div id={GOOGLE_BUTTON_ID} className="flex min-h-10 justify-center">
            <button
              type="button"
              disabled
              className="flex h-10 w-full max-w-80 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium text-muted-foreground"
            >
              <GoogleIcon />
              Continuer avec Google
            </button>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Deja un mot de passe ?{" "}
            <button
              type="button"
              onClick={() => router.navigate({ to: "/login" })}
              className="text-navy hover:underline font-medium"
            >
              Se connecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
