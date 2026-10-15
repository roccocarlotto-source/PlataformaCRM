import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import type { AuthContextValue } from "../../auth/AuthContext";
import { TallerResumenPage } from "./TallerResumenPage";
import type { ResumenDelTaller } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

beforeEach(() => {
  useAuthMock.mockReturnValue({
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "A",
      organizationId: "org-1",
      role: "USER",
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      modulos: ["servicios"],
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  });
});

const API = `${env.apiUrl}/api`;

const orden = (n: number) => ({
  id: `o${String(n)}`,
  numero: `OS-${String(n).padStart(4, "0")}`,
  cliente: "Ana Pérez",
  vehiculo: "Toyota Hilux (ABC 123)",
  desde: "2026-10-09T12:00:00.000Z",
});
const vehiculo = (n: number) => ({
  id: `v${String(n)}`,
  cliente: `Cliente ${String(n)}`,
  vehiculo: "Fiat Uno",
  fecha: "2026-10-01",
});

const RESUMEN: ResumenDelTaller = {
  hoy: "2026-10-15",
  enElTaller: { total: 4, porEstado: { RECIBIDO: 1, EN_TRABAJO: 2, ESPERANDO_APROBACION: 1 } },
  listosParaRetirar: { total: 1, items: [orden(1)] },
  esperandoAprobacion: { total: 0, items: [] },
  servicesVencidos: { total: 13, items: Array.from({ length: 10 }, (_, i) => vehiculo(i + 1)) },
  servicesEn30Dias: { total: 0, items: [] },
  turnosCancelados: { total: 0, items: [] },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TallerResumenPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Taller → Resumen (S11)", () => {
  it("las tarjetas con sus totales, las listas con link y 'y N más'", async () => {
    server.use(
      http.get(`${API}/servicios/dashboard`, () => HttpResponse.json(RESUMEN)),
      http.get(`${API}/branches`, () =>
        HttpResponse.json({
          data: [{ id: "b1", name: "Centro" }],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    renderPage();

    const enElTaller = (await screen.findByText("Autos en el taller: 4")).closest("section")!;
    expect(within(enElTaller).getByText("En trabajo: 2")).toBeInTheDocument();

    const listos = screen.getByText("Listos para retirar: 1").closest("section")!;
    expect(within(listos).getByRole("link", { name: "OS-0001" })).toHaveAttribute(
      "href",
      "/taller/ordenes/o1",
    );
    expect(within(listos).getByText(/Ana Pérez · Toyota Hilux \(ABC 123\)/)).toBeInTheDocument();

    const vencidos = screen.getByText("Services vencidos: 13").closest("section")!;
    expect(within(vencidos).getAllByRole("link")).toHaveLength(10);
    expect(within(vencidos).getByRole("link", { name: "Cliente 1" })).toHaveAttribute(
      "href",
      "/taller/vehiculos/v1",
    );
    expect(within(vencidos).getByText("y 3 más")).toBeInTheDocument();

    const esperando = screen
      .getByText("Esperando aprobación hace más de 24 h: 0")
      .closest("section")!;
    expect(within(esperando).getByText("Ninguna.")).toBeInTheDocument();
  });

  it("el filtro de sucursal pide el resumen de esa sucursal", async () => {
    const pedidos: (string | null)[] = [];
    server.use(
      http.get(`${API}/servicios/dashboard`, ({ request }) => {
        pedidos.push(new URL(request.url).searchParams.get("branchId"));
        return HttpResponse.json(RESUMEN);
      }),
      http.get(`${API}/branches`, () =>
        HttpResponse.json({
          data: [{ id: "b1", name: "Centro" }],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Autos en el taller: 4");
    await chooseSelectOption(user, screen.getByLabelText("Sucursal"), "Centro");
    await waitFor(() => expect(pedidos).toEqual([null, "b1"]));
  });
});
