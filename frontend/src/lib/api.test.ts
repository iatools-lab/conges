import { beforeEach, describe, expect, it, vi } from "vitest";
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
      "upowa.auth.session",
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

  it("does not send expired session tokens", async () => {
    window.localStorage.setItem(
      "upowa.auth.session",
      JSON.stringify({
        token: "expired-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        roles: [],
      }),
    );

    await apiFetch("/rh/dashboard");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/rh/dashboard"),
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });
});
