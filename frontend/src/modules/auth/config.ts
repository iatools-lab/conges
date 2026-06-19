const GOOGLE_ONLY_VALUES = new Set(["true", "1", "yes", "on"]);

export const AUTH_GOOGLE_ONLY = GOOGLE_ONLY_VALUES.has(
  ((import.meta.env.VITE_AUTH_GOOGLE_ONLY as string | undefined) ?? "").trim().toLowerCase(),
);
