import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeFichaDeOrden, makeVehiculoDeCliente } from "../../test/vehiculoDeClienteFixtures";
import { ConfiguracionDelTallerPage } from "./ConfiguracionDelTallerPage";
import { NuevaOrdenPage } from "./NuevaOrdenPage";
import { OrdenesPage } from "./OrdenesPage";
import { OrdenPage } from "./OrdenPage";

// Las pantallas de órdenes de S4a (docs/servicios.md §4.2–§4.3, §4.8).

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "a@example.com",
      fullName: "A",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
      canUseInternalAgent: false,
      modulos: ["servicios"],
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth("USER"));
  try {
    localStorage.clear();
  } catch {
    // sin almacenamiento
  }
});

const API = `${env.apiUrl}/api`;
const ORDENES = `${API}/servicios/ordenes`;

function comunes() {
  return [
    http.get(`${API}/servicios/usuarios`, () =>
      HttpResponse.json([{ id: "u1", fullName: "Encargado" }]),
    ),
    http.get(`${API}/servicios/tipos`, () =>
      HttpResponse.json([
        { id: "t6", name: "Cambio de aceite", nextServiceAfterMonths: 6, isActive: true },
      ]),
    ),
    http.get(`${API}/branches`, () =>
      HttpResponse.json({
        data: [{ id: "b1", name: "Taller Centro" }],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

function renderEn(ruta: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/taller/ordenes" element={<OrdenesPage />} />
          <Route path="/taller/ordenes/nueva" element={<NuevaOrdenPage />} />
          <Route path="/taller/ordenes/:id" element={<OrdenPage />} />
          <Route path="/taller/configuracion" element={<ConfiguracionDelTallerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Órdenes — tablero", () => {
  it("una columna por estado abierto, con sus tarjetas; pide solo las abiertas", async () => {
    let estados: string | null = null;
    server.use(
      ...comunes(),
      http.get(ORDENES, ({ request }) => {
        estados = new URL(request.url).searchParams.get("estados");
        const orden = makeFichaDeOrden({ status: "EN_TRABAJO" });
        return HttpResponse.json({
          data: [orden],
          pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
        });
      }),
    );
    renderEn("/taller/ordenes");
    const columna = await screen.findByRole("region", { name: "En trabajo" });
    expect(within(columna).getByRole("link", { name: "OS-0007" })).toHaveAttribute(
      "href",
      "/taller/ordenes/o1",
    );
    for (const titulo of ["Agendado", "Recibido", "Esperando aprobación", "Listo para retirar"]) {
      expect(screen.getByRole("region", { name: titulo })).toBeInTheDocument();
    }
    expect(screen.queryByRole("region", { name: "Entregado" })).toBeNull();
    expect(estados).toBe("AGENDADO,RECIBIDO,EN_TRABAJO,ESPERANDO_APROBACION,LISTO_PARA_RETIRAR");
  });
});

describe("Órdenes — ficha", () => {
  it("los botones son los pasos permitidos desde el estado; una final no tiene ninguno ni Editar", async () => {
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () => HttpResponse.json(makeFichaDeOrden({ status: "RECIBIDO" }))),
    );
    const { unmount } = renderEn("/taller/ordenes/o1");
    for (const boton of [
      "Empezar el trabajo",
      "Esperar aprobación",
      "Listo para retirar",
      "Cancelar la orden",
      "Editar",
    ]) {
      expect(await screen.findByRole("button", { name: boton })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Entregar" })).toBeNull();
    unmount();

    server.use(
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({ status: "ENTREGADO", deliveredAt: "2026-10-14T15:00:00.000Z" }),
        ),
      ),
    );
    renderEn("/taller/ordenes/o1");
    expect(await screen.findByText("Sin próximo service")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar aprobación" })).toBeNull();
  });

  it("entregar: propone la fecha, y Sin próximo service manda null", async () => {
    const cuerpos: unknown[] = [];
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "LISTO_PARA_RETIRAR",
            proximoServicePropuesto: { fecha: "2027-04-14", meses: 6 },
          }),
        ),
      ),
      http.post(`${ORDENES}/:id/estado`, async ({ request }) => {
        cuerpos.push(await request.json());
        return HttpResponse.json(makeFichaDeOrden({ status: "ENTREGADO" }));
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByLabelText("Próximo service")).toHaveValue("2027-04-14");
    expect(within(dialogo).getByText(/a los 6 meses/)).toBeInTheDocument();
    await user.click(within(dialogo).getByRole("button", { name: "Entregar" }));
    await waitFor(() => expect(cuerpos).toHaveLength(1));
    expect(cuerpos[0]).toEqual({
      desde: "LISTO_PARA_RETIRAR",
      hacia: "ENTREGADO",
      nota: null,
      proximoService: "2027-04-14",
    });
  });

  it("entregar sin próximo service", async () => {
    let cuerpo: unknown;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "LISTO_PARA_RETIRAR",
            proximoServicePropuesto: { fecha: "2027-04-14", meses: 6 },
          }),
        ),
      ),
      http.post(`${ORDENES}/:id/estado`, async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(makeFichaDeOrden({ status: "ENTREGADO" }));
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    await user.click(await screen.findByRole("button", { name: "Entregar" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByLabelText("Sin próximo service"));
    await user.click(within(dialogo).getByRole("button", { name: "Entregar" }));
    await waitFor(() => expect(cuerpo).toMatchObject({ proximoService: null }));
  });

  it("recibir exige km antes de pedir nada al backend", async () => {
    let pidio = false;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(makeFichaDeOrden({ status: "AGENDADO", mileageIn: null })),
      ),
      http.post(`${ORDENES}/:id/estado`, () => {
        pidio = true;
        return HttpResponse.json(makeFichaDeOrden());
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    await user.click(await screen.findByRole("button", { name: "Recibir el auto" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Recibir el auto" }));
    expect(await within(dialogo).findByText("Cargá los km al ingreso.")).toBeInTheDocument();
    expect(pidio).toBe(false);
  });

  it("esperando aprobación: el aviso, y registrar la aprobación con Sumar al valor", async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "ESPERANDO_APROBACION",
            aprobacionPendiente: true,
            amount: "1000.00",
            currency: "UYU",
          }),
        ),
      ),
      http.post(`${ORDENES}/:id/aprobaciones`, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeFichaDeOrden(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    expect(await screen.findByText("Falta registrar la respuesta del cliente")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Registrar aprobación" }));
    const dialogo = screen.getByRole("dialog");
    await user.type(within(dialogo).getByLabelText("Qué se le consultó"), "Pastillas de freno");
    await user.type(within(dialogo).getByLabelText("Quién respondió"), "El titular");
    await user.type(within(dialogo).getByLabelText("Monto (UYU)"), "2500");
    await user.click(within(dialogo).getByLabelText("Sumar al valor de la orden"));
    await user.click(within(dialogo).getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(cuerpo).toBeDefined());
    expect(cuerpo).toMatchObject({
      description: "Pastillas de freno",
      decision: "APROBADO",
      approverName: "El titular",
      channel: "TELEFONO",
      amount: 2500,
      currency: "UYU",
      sumarAlValor: true,
    });
  });
});

describe("Órdenes — nueva", () => {
  it("desde la ficha del vehículo: recibida con km; un 409 de auto en el taller ofrece abrir la orden", async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      ...comunes(),
      http.get(`${API}/servicios/vehiculos/:id`, () =>
        HttpResponse.json({ ...makeVehiculoDeCliente({ branchId: "b1" }), cambiosDeDueno: [] }),
      ),
      http.post(ORDENES, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            error: {
              message: "El vehículo ya está en el taller con la orden OS-0003.",
              code: "VEHICULO_EN_EL_TALLER",
              ordenId: "o3",
            },
          },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/nueva?vehiculoId=cv1");
    expect(
      await screen.findByRole("link", { name: "Toyota Hilux 2020 · SBC 1001" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByLabelText("Cambio de aceite (próximo a los 6 meses)"));
    await user.click(screen.getByRole("button", { name: "Crear orden" }));
    const abrir = await screen.findByRole("link", { name: "Abrir la orden" });
    expect(abrir).toHaveAttribute("href", "/taller/ordenes/o3");
    expect(cuerpo).toMatchObject({
      customerVehicleId: "cv1",
      branchId: "b1",
      estado: "RECIBIDO",
      mileageIn: 45000,
      jobTypeIds: ["t6"],
    });
  });
});

describe("Configuración del taller", () => {
  it("intervalos y tipos: guarda los meses y agrega un tipo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let configuracion: unknown;
    let tipo: unknown;
    server.use(
      http.get(`${API}/servicios/configuracion`, () =>
        HttpResponse.json({ defaultNextServiceMonths: 12, firstServiceAfterMonths: 12 }),
      ),
      http.put(`${API}/servicios/configuracion`, async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        configuracion = cuerpo;
        return HttpResponse.json(cuerpo);
      }),
      http.get(`${API}/servicios/tipos`, () => HttpResponse.json([])),
      http.post(`${API}/servicios/tipos`, async ({ request }) => {
        tipo = await request.json();
        return HttpResponse.json(
          { id: "t1", isActive: true, ...(tipo as object) },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/configuracion");
    const porDefecto = await screen.findByLabelText("Intervalo por defecto (meses)");
    await user.clear(porDefecto);
    await user.type(porDefecto, "6");
    await user.clear(screen.getByLabelText("Primer service de un auto vendido (meses)"));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(configuracion).toEqual({ defaultNextServiceMonths: 6, firstServiceAfterMonths: null }),
    );

    await user.type(screen.getByLabelText("Nombre del tipo nuevo"), "Alineación");
    await user.click(screen.getByRole("button", { name: "Agregar tipo" }));
    await waitFor(() => expect(tipo).toEqual({ name: "Alineación", nextServiceAfterMonths: null }));
  });
});
