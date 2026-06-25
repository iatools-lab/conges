import { AUTH_SESSION_KEY, clearAuthSession, isAuthSessionExpired } from "@/modules/auth/session";

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:3000/api/v1";

type ApiErrorBody = {
  message?: string | string[];
  error?: string;
};

const SESSION_EXPIRED_MESSAGE = "Votre session a expiré. Veuillez vous reconnecter.";

function isAuthEndpoint(path: string) {
  return path.startsWith("/auth/");
}

function getSessionToken(path: string) {
  if (typeof window === "undefined") return "";

  const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return "";

  let parsed: { token?: string; expiresAt?: string };
  try {
    parsed = JSON.parse(raw) as { token?: string; expiresAt?: string };
  } catch {
    return "";
  }

  if (!parsed.token) return "";
  if (isAuthSessionExpired(parsed)) {
    clearAuthSession();
    if (!isAuthEndpoint(path)) throw new Error(SESSION_EXPIRED_MESSAGE);
    return "";
  }

  return parsed.token;
}

function getApiErrorMessage(body: ApiErrorBody, fallback: string) {
  if (Array.isArray(body.message)) return body.message.join(", ");
  return body.message ?? body.error ?? fallback;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (!headers.Authorization) {
    const token = getSessionToken(path);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const isForm = options.body instanceof FormData;
  if (!isForm) {
    if (options.body && typeof options.body !== "string") {
      options.body = JSON.stringify(options.body);
    }
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Impossible de joindre le backend. Vérifiez que l'API tourne (backend) et que l'URL API est correcte.",
    );
  }

  if (!response.ok) {
    if (response.status === 401 && !isAuthEndpoint(path)) {
      clearAuthSession();
      throw new Error(SESSION_EXPIRED_MESSAGE);
    }

    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }

    throw new Error(getApiErrorMessage(body, `Erreur API ${response.status}`));
  }

  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}
