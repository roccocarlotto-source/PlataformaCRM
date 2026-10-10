import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { Booking } from "../booking/types";
import { MarcarTurno } from "./MarcarTurno";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const TURNO: Booking = {
  id: "bk1",
  organizationId: "o1",
  branchId: "b1",
  serviceTypeId: "st1",
  resourceId: "r1",
  contactId: "c1",
  opportunityId: null,
  startsAt: "2027-03-01T12:00:00.000Z",
  endsAt: "2027-03-01T13:00:00.000Z",
  status: "CONFIRMED",
  googleEventId: null,
  createdAt: "2027-02-20T12:00:00.000Z",
  updatedAt: "2027-02-20T12:00:00.000Z",
};

function renderizar(booking: Booking, onDone = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MarcarTurno booking={booking} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe("MarcarTurno (R10)", () => {
  it("marca No vino con la nota opcional y avisa que no se carguen datos de salud", async () => {
    let enviado: unknown;
    server.use(
      http.patch(`${env.apiUrl}/api/bookings/bk1/no-show`, async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...TURNO, status: "NO_SHOW" });
      }),
    );
    const user = userEvent.setup();
    const onDone = renderizar(TURNO);
    expect(screen.getByText(/No cargues datos de salud/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Nota (opcional)"), "Avisó tarde");
    await user.click(screen.getByRole("button", { name: "No vino" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(enviado).toEqual({ nota: "Avisó tarde" });
  });

  it("un turno ya atendido ofrece solo la corrección a No vino", () => {
    renderizar({ ...TURNO, status: "COMPLETED" });
    expect(screen.getByRole("button", { name: "Corregir a No vino" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Atendido/ })).not.toBeInTheDocument();
  });
});
