import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_SESSION_KEY } from "@/modules/auth/session";
import { apiFetch } from "./api";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
  });

  it("sends the signed session token as a Bearer authorization header", async () => {
    window.localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        token: "signed-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        roles: ["admin"],
      }),
    );

    await apiFetch("/admin/users");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/admin/users"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer signed-token" }),
      }),
    );
  });

  it("clears expired sessions before calling protected endpoints", async () => {
    window.localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        token: "expired-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        roles: [],
      }),
    );

    await expect(apiFetch("/rh/dashboard")).rejects.toThrow("session");

    expect(fetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });

  it("clears the current session when a protected endpoint returns 401", async () => {
    window.localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({
        token: "signed-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        roles: ["rh"],
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiFetch("/rh/dashboard")).rejects.toThrow("session");

    expect(window.localStorage.getItem(AUTH_SESSION_KEY)).toBeNull();
  });
});
