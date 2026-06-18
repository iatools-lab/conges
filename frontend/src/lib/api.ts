const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  "http://localhost:3000/api/v1";

type ApiErrorBody = {
  message?: string | string[];
  error?: string;
};

function getSessionToken() {
  if (typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem("upowa.auth.session");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: string };
    if (!parsed.token) return "";
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) return "";
    return parsed.token;
  } catch {
    return "";
  }
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
    const token = getSessionToken();
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
