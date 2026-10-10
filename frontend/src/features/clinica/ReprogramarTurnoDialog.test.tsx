import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { Booking } from "../booking/types";
import { ReprogramarTurnoDialog } from "./ReprogramarTurnoDialog";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));
const useAuthMock = vi.hoisted(() => vi.fn<() => Partial<AuthContextValue>>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

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

describe("ReprogramarTurnoDialog (R9)", () => {
  it("ofrece los horarios (con los sobreturnos marcados) y manda el PATCH /reschedule elegido", async () => {
    useAuthMock.mockReturnValue({ me: null });
    let enviado: unknown;
    server.use(
      http.get(`${env.apiUrl}/api/clinica/prestaciones`, () =>
        HttpResponse.json({
          prestaciones: [
            {
              id: "st1",
              branchId: "b1",
              name: "Consulta",
              durationMin: 60,
              capacity: 1,
              resourceId: "r1",
              profesionales: [{ id: "r1", name: "Ana", branchId: "b1" }],
            },
          ],
        }),
      ),
      http.get(`${env.apiUrl}/api/clinica/disponibilidad`, () =>
        HttpResponse.json({
          availability: [
            {
              startsAt: "2027-03-01T14:00:00.000Z",
              endsAt: "2027-03-01T15:00:00.000Z",
              availableSeats: 1,
              resource: { id: "r1", name: "Ana" },
            },
            {
              startsAt: "2027-03-01T15:00:00.000Z",
              endsAt: "2027-03-01T16:00:00.000Z",
              availableSeats: 0,
              resource: { id: "r1", name: "Ana" },
              overbooking: true,
            },
          ],
        }),
      ),
      http.patch(`${env.apiUrl}/api/bookings/bk1/reschedule`, async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json({ ...TURNO, startsAt: "2027-03-01T15:00:00.000Z" });
      }),
    );
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReprogramarTurnoDialog booking={TURNO} onClose={onClose} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByLabelText("Horario nuevo"));
    await user.click(await screen.findByText(/\(sobreturno\)/));
    await user.click(screen.getByRole("button", { name: "Reprogramar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(enviado).toEqual({
      startsAt: "2027-03-01T15:00:00.000Z",
      resourceId: "r1",
      isOverbooking: true,
    });
  });
});
