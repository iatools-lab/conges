import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { NewRequestForm, type LeaveTypeOption } from "./NewRequestForm";
import type { AuthSession } from "@/modules/auth/session";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

const session: AuthSession = {
  id: "employee-1",
  matricule: "EMP001",
  email: "employee@upowa.org",
  name: "Employee Test",
  poste: "Agent",
  department: { id: "dept-1", code: "OPS", name: "Operations" },
  roles: ["employee"],
  primaryRole: "employee",
  homePath: "/",
};

const leaveTypes: LeaveTypeOption[] = [{ code: "CP", name: "Congé payé", requiresProof: false }];
const leaveTypesWithMaternity: LeaveTypeOption[] = [
  ...leaveTypes,
  { code: "MAT", name: "Congés maternité", requiresProof: true },
];
const specialLeaveTypes: LeaveTypeOption[] = [
  {
    code: "SPECIAL",
    name: "Congés spéciaux",
    category: "CONGE_SPECIAL",
    requiresProof: true,
    children: [
      {
        code: "PAT",
        name: "Congé paternité",
        category: "CONGE_PATERNITE",
        requiresProof: true,
      },
    ],
  },
];

function mockFormApi(
  balances: Array<{ code: string; remaining: number }>,
  holidays: Array<{ id: string; date: string; name: string; recurring: boolean }> = [],
  specialRemaining?: number,
) {
  vi.mocked(apiFetch).mockImplementation((path) =>
    Promise.resolve(
      path.includes("/holidays")
        ? { rows: holidays }
        : {
            rows: balances,
            ...(specialRemaining === undefined
              ? {}
              : { specialTotals: { remaining: specialRemaining } }),
          },
    ),
  );
}

describe("NewRequestForm", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockFormApi([{ code: "CP", remaining: 10 }]);
  });

  it("submits a planned draft payload in planning mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NewRequestForm
        session={session}
        leaveTypes={leaveTypes}
        mode="planning"
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /planifier/i }));
    expect(await screen.findByText("Planifier un congé")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveClass("overflow-y-auto");

    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/date de fin/i), {
      target: { value: "2026-06-03" },
    });
    fireEvent.change(screen.getByLabelText(/commentaire/i), {
      target: { value: "Plan annuel" },
    });

    await user.click(screen.getByRole("button", { name: /enregistrer la planification/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      leaveTypeCode: "CP",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      reason: "Plan annuel",
      draft: true,
    });
  });

  it("submits a normal request payload without draft mode", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NewRequestForm session={session} leaveTypes={leaveTypes} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /nouvelle demande/i }));
    expect(await screen.findByText("Nouvelle demande de congé")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/date de fin/i), {
      target: { value: "2026-06-03" },
    });

    await user.click(screen.getByRole("button", { name: /envoyer la demande/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      leaveTypeCode: "CP",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      reason: undefined,
      draft: undefined,
    });
  });

  it("blocks submission when requested days exceed available balance", async () => {
    mockFormApi([{ code: "CP", remaining: 1 }]);
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NewRequestForm session={session} leaveTypes={leaveTypes} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /nouvelle demande/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/date de fin/i), {
      target: { value: "2026-06-03" },
    });

    expect(await screen.findByText(/excède le solde disponible \(1\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /envoyer la demande/i })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("excludes public holidays from the displayed working-day count", async () => {
    mockFormApi(
      [{ code: "CP", remaining: 10 }],
      [
        {
          id: "holiday-1",
          date: "2026-06-02",
          name: "Jour férié",
          recurring: false,
        },
      ],
    );
    const user = userEvent.setup();
    render(<NewRequestForm session={session} leaveTypes={leaveTypes} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /nouvelle demande/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/employee/leave-requests/holidays"));
    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/date de fin/i), {
      target: { value: "2026-06-03" },
    });

    expect(await screen.findByDisplayValue("2 jour(s) ouvré(s)")).toBeInTheDocument();
  });

  it("forces maternity leave to use the full 90-day entitlement", async () => {
    mockFormApi([
      { code: "CP", remaining: 10 },
      { code: "MAT", remaining: 90 },
    ]);
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NewRequestForm session={session} leaveTypes={leaveTypesWithMaternity} onSubmit={onSubmit} />,
    );

    await user.click(screen.getByRole("button", { name: /nouvelle demande/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(/type de congé/i), {
      target: { value: "MAT" },
    });
    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/date de fin/i)).toHaveValue("2026-10-02");
    });
    expect(screen.getByLabelText(/date de fin/i)).toBeDisabled();
    expect(screen.getByDisplayValue("90 jour(s) ouvré(s)")).toBeInTheDocument();

    const proof = new File(["preuve"], "preuve.pdf", {
      type: "application/pdf",
    });
    await user.upload(screen.getByLabelText(/justificatif/i), proof);

    await user.click(screen.getByRole("button", { name: /envoyer la demande/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      leaveTypeCode: "MAT",
      startDate: "2026-06-01",
      endDate: "2026-10-02",
      reason: undefined,
      draft: undefined,
      proof,
    });
  });

  it("keeps proof optional for special leave and uses the shared 12-day balance", async () => {
    mockFormApi(
      [
        { code: "SPE", remaining: 12 },
        { code: "PAT", remaining: 0 },
      ],
      [],
      9,
    );
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NewRequestForm session={session} leaveTypes={specialLeaveTypes} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /nouvelle demande/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByText(/justificatif \(optionnel\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/date de début/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/date de fin/i), {
      target: { value: "2026-06-03" },
    });

    expect(await screen.findByText(/solde disponible: 9 jour/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /envoyer la demande/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      leaveTypeCode: "SPECIAL",
      leaveSubtypeCode: "PAT",
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      reason: undefined,
      draft: undefined,
    });
  });
});
