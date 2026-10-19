import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeOrganizationSettings } from "../../test/organizationFixtures";
import { chooseSelectOption } from "../../test/chooseSelectOption";
import { makeBooking } from "../../test/bookingFixtures";
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

// La organización vende en USD; el taller cobra en su propia moneda (#12).
function comunes(monedaDelTaller = "UYU") {
  return [
    http.get(`${API}/organization`, () =>
      HttpResponse.json(makeOrganizationSettings({ preferredCurrency: "USD" })),
    ),
    http.get(`${API}/servicios/configuracion`, () =>
      HttpResponse.json({
        defaultNextServiceMonths: 12,
        firstServiceAfterMonths: 12,
        currency: monedaDelTaller,
      }),
    ),
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
      "Pasar a En trabajo",
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
    // Sin la respuesta del cliente, salir hacia trabajo o retiro está frenado
    // antes de intentarlo; cancelar no (prueba de S4a).
    expect(screen.getByRole("button", { name: "Pasar a En trabajo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Listo para retirar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar la orden" })).toBeEnabled();
    // El aviso trae el atajo (y la tarjeta de Aprobaciones, el suyo).
    const atajos = screen.getAllByRole("button", { name: "Registrar aprobación" });
    expect(atajos).toHaveLength(2);
    await user.click(atajos[0]);
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

describe("Órdenes — correcciones de la prueba de S4a", () => {
  it("nueva orden: el encargado es quien la crea y la moneda, la del taller (editables)", async () => {
    const cuerpos: Record<string, unknown>[] = [];
    // La organización está en USD en los dos casos: manda la del taller (#12).
    for (const esperada of ["UYU", "USD"] as const) {
      server.use(
        ...comunes(esperada),
        http.get(`${API}/servicios/vehiculos/:id`, () =>
          HttpResponse.json({ ...makeVehiculoDeCliente({ branchId: "b1" }), cambiosDeDueno: [] }),
        ),
        http.post(ORDENES, async ({ request }) => {
          cuerpos.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json(makeFichaDeOrden(), { status: 201 });
        }),
        // Después de crear, navega a la ficha.
        http.get(`${ORDENES}/:id`, () => HttpResponse.json(makeFichaDeOrden())),
      );
      const user = userEvent.setup();
      const { unmount } = renderEn("/taller/ordenes/nueva?vehiculoId=cv1");
      expect(await screen.findByRole("combobox", { name: "Encargado" })).toHaveValue("Encargado");
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue(esperada),
      );
      await user.type(screen.getByLabelText("Valor"), "40");
      await user.click(screen.getByRole("button", { name: "Crear orden" }));
      await waitFor(() => expect(cuerpos).toHaveLength(esperada === "UYU" ? 1 : 2));
      expect(cuerpos.at(-1)).toMatchObject({ assigneeId: "u1", amount: 40, currency: esperada });
      unmount();
    }
  });

  it('"Volver a trabajo" solo si ya estuvo en trabajo; el diálogo se cierra con Cancelar', async () => {
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "LISTO_PARA_RETIRAR",
            workStartedAt: "2026-10-14T15:00:00.000Z",
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    await user.click(await screen.findByRole("button", { name: "Volver a trabajo" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).queryByRole("button", { name: "Volver" })).toBeNull();
    await user.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("lista: el mensaje vacío dice si no hay abiertas o si la búsqueda no encontró nada", async () => {
    server.use(
      ...comunes(),
      http.get(ORDENES, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );
    localStorage.setItem("servicios:ordenes:vista", "lista");
    const user = userEvent.setup();
    renderEn("/taller/ordenes");
    expect(await screen.findByText("No hay órdenes abiertas")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("Ninguna orden coincide con «zzz»")).toBeInTheDocument();
  });
});

// S4b (§4.4): el turno de la agenda y la orden.
describe("Órdenes — el turno de la agenda (S4b)", () => {
  const TURNO = {
    id: "bk1",
    startsAt: "2030-01-20T13:00:00.000Z",
    endsAt: "2030-01-20T14:00:00.000Z",
    status: "CONFIRMED" as const,
    servicio: "Service",
    recurso: "Elevador 1",
  };

  it("crear desde el turno: vehículo del cliente, Agendada en la sucursal del turno y vinculada", async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      ...comunes(),
      http.get(`${API}/bookings/:id`, () =>
        HttpResponse.json(
          makeBooking({
            id: "bk1",
            contactId: "ct1",
            branchId: "b1",
            startsAt: TURNO.startsAt,
            endsAt: TURNO.endsAt,
          }),
        ),
      ),
      http.get(`${API}/servicios/vehiculos`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("contactId")).toBe("ct1");
        return HttpResponse.json({
          data: [makeVehiculoDeCliente()],
          pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
        });
      }),
      http.get(`${API}/servicios/vehiculos/:id`, () =>
        HttpResponse.json({ ...makeVehiculoDeCliente(), cambiosDeDueno: [] }),
      ),
      http.post(ORDENES, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeFichaDeOrden(), { status: 201 });
      }),
      http.get(`${ORDENES}/:id`, () => HttpResponse.json(makeFichaDeOrden())),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/nueva?turnoId=bk1");
    expect(await screen.findByRole("heading", { name: "Turno" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /SBC 1001/ }));
    expect(await screen.findByText(/(el horario del turno)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear orden" }));
    await waitFor(() => expect(cuerpo).toBeDefined());
    expect(cuerpo).toMatchObject({
      customerVehicleId: "cv1",
      branchId: "b1",
      estado: "AGENDADO",
      bookingId: "bk1",
    });
    expect(cuerpo).not.toHaveProperty("scheduledFor");
  });

  it("turno cancelado: la ficha lo avisa, y Vincular otro turno manda el elegido", async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "AGENDADO",
            bookingId: "bk1",
            scheduledFor: TURNO.startsAt,
            turno: { ...TURNO, status: "CANCELLED" },
          }),
        ),
      ),
      http.get(`${API}/servicios/turnos`, () =>
        HttpResponse.json([
          {
            id: "bk2",
            startsAt: "2030-01-27T13:00:00.000Z",
            endsAt: "2030-01-27T14:00:00.000Z",
            branch: { id: "b1", name: "Taller Centro" },
            servicio: "Service",
            recurso: "Elevador 1",
          },
        ]),
      ),
      http.patch(`${ORDENES}/:id`, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeFichaDeOrden());
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    expect(await screen.findByText("El turno vinculado fue cancelado")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vincular otro turno" }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(await within(dialogo).findByRole("button", { name: "Vincular" }));
    await waitFor(() => expect(cuerpo).toEqual({ bookingId: "bk2" }));
  });

  it("desvincular confirma y manda null; cancelar la orden aclara que el turno sigue", async () => {
    let cuerpo: Record<string, unknown> | undefined;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(
          makeFichaDeOrden({
            status: "AGENDADO",
            bookingId: "bk1",
            scheduledFor: TURNO.startsAt,
            turno: TURNO,
          }),
        ),
      ),
      http.patch(`${ORDENES}/:id`, async ({ request }) => {
        cuerpo = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeFichaDeOrden());
      }),
    );
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    // Sin aviso: el turno sigue confirmado y en el mismo horario.
    expect(await screen.findByText(/Service · Elevador 1/)).toBeInTheDocument();
    expect(screen.queryByText("El turno vinculado fue cancelado")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Cancelar la orden" }));
    const dialogo = await screen.findByRole("dialog");
    expect(
      within(dialogo).getByText(/sigue en la agenda: cancelalo desde ahí/),
    ).toBeInTheDocument();
    await user.click(within(dialogo).getByRole("button", { name: "No cancelar" }));

    await user.click(screen.getByRole("button", { name: "Desvincular" }));
    await waitFor(() => expect(cuerpo).toEqual({ bookingId: null }));
    confirmar.mockRestore();
  });
});

describe("Configuración del taller", () => {
  it("intervalos y tipos: guarda los meses y agrega un tipo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let configuracion: unknown;
    let tipo: unknown;
    server.use(
      http.get(`${API}/servicios/configuracion`, () =>
        HttpResponse.json({
          defaultNextServiceMonths: 12,
          firstServiceAfterMonths: 12,
          currency: "UYU",
        }),
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
    const intervalos = porDefecto.closest("form")!;
    await user.click(within(intervalos).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(configuracion).toEqual({ defaultNextServiceMonths: 6, firstServiceAfterMonths: null }),
    );

    // El botón no está apagado: sin nombre, lo dice al apretarlo.
    const agregar = screen.getByRole("button", { name: "Agregar tipo" });
    expect(agregar).toBeEnabled();
    await user.click(agregar);
    expect(await screen.findByText("Escribí el nombre del service.")).toBeInTheDocument();
    expect(tipo).toBeUndefined();

    await user.type(screen.getByLabelText("Nombre del service"), "Alineación");
    expect(screen.getByLabelText("Cada cuántos meses")).toBeInTheDocument();
    await user.click(agregar);
    await waitFor(() => expect(tipo).toEqual({ name: "Alineación", nextServiceAfterMonths: null }));
  });

  it("moneda del taller: arranca en la guardada y guarda solo la moneda (#12)", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let configuracion: unknown;
    server.use(
      http.get(`${API}/servicios/configuracion`, () =>
        HttpResponse.json({
          defaultNextServiceMonths: 12,
          firstServiceAfterMonths: 12,
          currency: "UYU",
        }),
      ),
      http.put(`${API}/servicios/configuracion`, async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        configuracion = cuerpo;
        return HttpResponse.json({
          defaultNextServiceMonths: 12,
          firstServiceAfterMonths: 12,
          ...cuerpo,
        });
      }),
      http.get(`${API}/servicios/tipos`, () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderEn("/taller/configuracion");
    const moneda = await screen.findByRole("combobox", { name: "Moneda" });
    expect(moneda).toHaveValue("UYU");
    await chooseSelectOption(user, moneda, "USD");
    await user.click(within(moneda.closest("form")!).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(configuracion).toEqual({ currency: "USD" }));
    expect(await screen.findByText("Guardado.")).toBeInTheDocument();
  });
});

// S12 (docs/servicios.md §8.1): avisar al cliente desde la ficha.
describe("Órdenes — avisar al cliente", () => {
  const avisosUrl = `${ORDENES}/o1/avisos`;
  const SUGERENCIA = "Hola Ana, tu Fiat Uno ya está listo. Podés pasar a retirarlo por Centro.";

  it("con la ventana abierta: abre la conversación con el texto y la orden; marcar como avisado manda el medio", async () => {
    let medio: unknown = null;
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(makeFichaDeOrden({ status: "LISTO_PARA_RETIRAR" })),
      ),
      http.get(avisosUrl, () =>
        HttpResponse.json({
          sugerencia: SUGERENCIA,
          conversacion: { id: "c1", ventanaAbierta: true },
          telefono: "+59899000111",
          avisos: [
            {
              id: "a1",
              cuando: "2026-10-15T15:00:00.000Z",
              persona: "Rocco Taller",
              detalle: "Aviso al cliente (Teléfono): Recibido",
            },
          ],
        }),
      ),
      http.post(avisosUrl, async ({ request }) => {
        medio = ((await request.json()) as { medio: string }).medio;
        return HttpResponse.json([], { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");

    expect(await screen.findByText("Aviso al cliente (Teléfono): Recibido")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Avisar al cliente" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByLabelText("Texto sugerido")).toHaveValue(SUGERENCIA);
    const abrir = within(dialogo).getByRole("link", { name: "Abrir la conversación" });
    expect(abrir).toHaveAttribute(
      "href",
      `/conversations/c1?borrador=${encodeURIComponent(SUGERENCIA)}&orden=o1`,
    );
    expect(within(dialogo).getByRole("link", { name: "Llamar" })).toHaveAttribute(
      "href",
      "tel:+59899000111",
    );

    await user.click(within(dialogo).getByLabelText("En persona"));
    await user.click(within(dialogo).getByRole("button", { name: "Marcar como avisado" }));
    await waitFor(() => expect(medio).toBe("EN_PERSONA"));
  });

  it("con la ventana vencida no ofrece abrir la conversación: lo explica, y quedan copiar y llamar", async () => {
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(makeFichaDeOrden({ status: "LISTO_PARA_RETIRAR" })),
      ),
      http.get(avisosUrl, () =>
        HttpResponse.json({
          sugerencia: SUGERENCIA,
          conversacion: { id: "c1", ventanaAbierta: false },
          telefono: null,
          avisos: [],
        }),
      ),
    );
    const user = userEvent.setup();
    renderEn("/taller/ordenes/o1");
    await user.click(await screen.findByRole("button", { name: "Avisar al cliente" }));
    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).queryByRole("link", { name: "Abrir la conversación" })).toBeNull();
    expect(within(dialogo).getByText(/Pasaron más de 24 h/)).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Copiar el texto" })).toBeInTheDocument();
    expect(within(dialogo).queryByRole("link", { name: "Llamar" })).toBeNull();
  });

  it("en un estado sin texto sugerido no hay botón", async () => {
    server.use(
      ...comunes(),
      http.get(`${ORDENES}/:id`, () =>
        HttpResponse.json(makeFichaDeOrden({ status: "EN_TRABAJO" })),
      ),
      http.get(avisosUrl, () =>
        HttpResponse.json({ sugerencia: null, conversacion: null, telefono: null, avisos: [] }),
      ),
    );
    renderEn("/taller/ordenes/o1");
    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Avisar al cliente" })).toBeNull();
  });
});
