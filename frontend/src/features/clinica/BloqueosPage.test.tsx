import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeResource } from "../../test/resourceFixtures";
import type { AuthContextValue } from "../../auth/AuthContext";
import { BloqueosPage } from "./BloqueosPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));
const useAuthMock = vi.hoisted(() => vi.fn<() => Partial<AuthContextValue>>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function renderPage() {
  // Una Recepción de la sede b1: solo ve a los profesionales de su sede.
  useAuthMock.mockReturnValue({
    me: {
      id: "u1",
      email: "persona@example.com",
      fullName: "Recepción",
      organizationId: "o1",
      role: "RECEPCION",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      industry: "CLINICA",
      sedes: [{ id: "b1", name: "Centro" }],
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BloqueosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BloqueosPage (R6)", () => {
  it("ofrece solo los profesionales de sus sedes y, al bloquear, lista los turnos que quedan adentro sin cancelarlos", async () => {
    let enviado: unknown;
    server.use(
      http.get(`${env.apiUrl}/api/resources`, () =>
        HttpResponse.json({
          data: [
            makeResource({ id: "r1", name: "Ana Profesional", branchId: "b1" }),
            makeResource({ id: "r2", name: "Carla Profesional", branchId: "b2" }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
      http.get(`${env.apiUrl}/api/clinica/profesionales/r1/bloqueos`, () =>
        HttpResponse.json({ bloqueos: [] }),
      ),
      http.post(`${env.apiUrl}/api/clinica/profesionales/r1/bloqueos`, async ({ request }) => {
        enviado = await request.json();
        return HttpResponse.json(
          {
            bloqueo: {
              id: "t1",
              resourceId: "r1",
              startsAt: "2027-03-01T13:00:00.000Z",
              endsAt: "2027-03-01T15:00:00.000Z",
              reason: null,
              createdAt: "2027-02-28T12:00:00.000Z",
            },
            turnosAfectados: [
              {
                bookingId: "bk1",
                startsAt: "2027-03-01T14:00:00.000Z",
                endsAt: "2027-03-01T15:00:00.000Z",
                isOverbooking: false,
                paciente: { id: "c1", nombre: "Paciente Ejemplo" },
                prestacion: { id: "st1", name: "Consulta" },
                tareaId: "a1",
              },
            ],
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();

    expect(
      await screen.findByText("No hay bloqueos en los próximos dos meses"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Carla Profesional")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Desde"), "2027-03-01T10:00");
    await user.type(screen.getByLabelText("Hasta"), "2027-03-01T12:00");
    await user.click(screen.getByRole("button", { name: "Bloquear" }));

    expect(await screen.findByText("Turnos dentro del bloqueo")).toBeInTheDocument();
    expect(screen.getByText("Paciente Ejemplo")).toBeInTheDocument();
    expect(screen.getByText(/siguen en pie: no se cancelaron/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar turno" })).toBeInTheDocument();
    expect(enviado).toMatchObject({ startsAt: expect.any(String), endsAt: expect.any(String) });
  });
});
