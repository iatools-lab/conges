import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { disableRootShellForStaticClient } from "./modules/routing/__root";
import { getRouter } from "./router";

describe("static client", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    window.history.pushState({}, "", "/login");
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("allows email login without an access-code field", async () => {
    disableRootShellForStaticClient();
    render(<RouterProvider router={getRouter()} />);

    const emailInput = await screen.findByLabelText(/email professionnel/i);

    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    expect(emailInput).toHaveValue("user@example.com");
    expect(screen.queryByLabelText(/code d’accès/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continuer avec google/i })).toBeInTheDocument();
  });
});
