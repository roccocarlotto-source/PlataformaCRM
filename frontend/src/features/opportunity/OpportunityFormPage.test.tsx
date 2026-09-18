import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chooseSelectOption, listSelectOptions } from "../../test/chooseSelectOption";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeQuote, makeQuoteList } from "../../test/quoteFixtures";
import { makeDelivery } from "../../test/deliveryFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { makeVehicleDetail, makeVehicleListItem } from "../../test/vehicleFixtures";
import { todayIsoDate } from "./boardMove";
import { OpportunityFormPage } from "./OpportunityFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// El formulario preselecciona a quien crea a partir de useAuth().me (ítem 7
// de docs/frontend-cambios-pendientes.md). Se mockea por ruta de módulo, como
// en OpportunityListPage.test.tsx: "u1" es Ana Pérez en baseHandlers(), así
// que el select puede mostrarla como seleccionada.
const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(): AuthContextValue {
  return {
    status: "authenticated",
    me: {
      id: "u1",
      email: "ana@x.com",
      fullName: "Ana Pérez",
      organizationId: "org-1",
      role: "ADMIN",
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

beforeEach(() => {
  useAuthMock.mockReturnValue(mockAuth());
});

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;
const quotesUrl = `${env.apiUrl}/api/quotes`;
const deliveriesUrl = `${env.apiUrl}/api/deliveries`;
const paymentsUrl = `${env.apiUrl}/api/payments`;

// PipelineSelect y UserSelect se montan SIEMPRE en este form (sin
// `enabled` gating por texto, a diferencia de CompanySelect/ContactSelect)
// — todo test necesita estos dos handlers como mínimo.
function baseHandlers() {
  return [
    // La sección de Cotización (§39) se monta en edición y pide el historial
    // de la oportunidad. Vacío por defecto: los tests del formulario no la
    // miran; los dos del final sí.
    http.get(quotesUrl, () => HttpResponse.json(makeQuoteList([], null))),
    // La de Entrega (§40) solo pide con la oportunidad ganada. Vacía por
    // defecto: una ganada sin unidad no tiene entrega.
    http.get(deliveriesUrl, () => HttpResponse.json({ data: [] })),
    // La de Pagos (§43) se monta siempre en edición y pide el historial.
    // Vacío por defecto.
    http.get(paymentsUrl, () =>
      HttpResponse.json({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      }),
    ),
    // La de Permuta (§41) se monta siempre en edición y lista las unidades
    // con ?tradeInOpportunityId=. Vacía por defecto. Solo responde a ESA
    // consulta: cualquier otro GET /vehicles (la búsqueda de VehicleSelect)
    // sigue de largo hasta vehicleHandlers() — un resolver que no devuelve
    // nada en MSW pasa al siguiente handler.
    http.get(`${env.apiUrl}/api/vehicles`, ({ request }) => {
      if (!new URL(request.url).searchParams.has("tradeInOpportunityId")) return undefined;
      return HttpResponse.json({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
      });
    }),
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [
          makePipeline({ id: "pl1", name: "Ventas" }),
          makePipeline({ id: "pl2", name: "Postventa" }),
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    ),
    http.get(usersUrl, () =>
      HttpResponse.json({
        data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
    http.get(stagesUrl, ({ request }) => {
      const pipelineId = new URL(request.url).searchParams.get("pipelineId");
      // "Ventas" (pl1) tiene las tres variantes que gobiernan §50: una etapa
      // normal y las dos marcadas. Los flags son los REALES del contrato
      // (isWon/isLost), nunca el nombre.
      const stages =
        pipelineId === "pl1"
          ? [
              makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto", order: 1 }),
              makeStage({
                id: "st-ganada",
                pipelineId: "pl1",
                name: "Cierre ganado",
                order: 2,
                isWon: true,
              }),
              makeStage({
                id: "st-perdida",
                pipelineId: "pl1",
                name: "Cierre perdido",
                order: 3,
                isLost: true,
              }),
            ]
          : pipelineId === "pl2"
            ? [makeStage({ id: "st2", pipelineId: "pl2", name: "Cierre" })]
            : [];
      return HttpResponse.json({
        data: stages,
        pagination: { page: 1, pageSize: 100, total: stages.length, totalPages: 1 },
      });
    }),
  ];
}

const vehiclesUrl = `${env.apiUrl}/api/vehicles`;

// VehicleSelect (Fase 3b): la búsqueda (GET /vehicles?q=...) devuelve dos
// unidades disponibles; la resolución por id (GET /vehicles/:id) devuelve la
// ficha con el estado que se pida — RESERVED es el caso normal de una
// oportunidad abierta con unidad vinculada.
function vehicleHandlers(selectedStatus: "AVAILABLE" | "RESERVED" = "RESERVED") {
  return [
    http.get(vehiclesUrl, () =>
      HttpResponse.json({
        data: [
          makeVehicleListItem({ id: "v1", priceListUsd: "25000.00" }),
          makeVehicleListItem({ id: "v2", make: "Ford", model: "Ranger", priceListUsd: "40000" }),
        ],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
    ),
    http.get(`${vehiclesUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeVehicleDetail({
          id: params.id as string,
          make: params.id === "v2" ? "Ford" : "Toyota",
          model: params.id === "v2" ? "Ranger" : "Corolla",
          status: selectedStatus,
          priceListUsd: params.id === "v2" ? "40000" : "25000.00",
        }),
      ),
    ),
  ];
}

const VEHICLE_PLACEHOLDER = "Buscar disponible por marca, modelo, patente, VIN o código…";
const PRICE_HINT = /Se completa con el precio de la unidad al guardar/;

function renderForm(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/opportunities/new" element={<OpportunityFormPage />} />
          <Route path="/opportunities/:id/edit" element={<OpportunityFormPage />} />
          <Route path="/opportunities" element={<div>lista de oportunidades</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OpportunityFormPage", () => {
  it("create: envía companyId/pipelineId/stageId, navega tras el éxito", async () => {
    let postedBody: unknown;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
      http.get(`${env.apiUrl}/api/companies`, () =>
        HttpResponse.json({
          data: [
            {
              id: "co1",
              organizationId: "org-1",
              ownerId: null,
              name: "Acme Corp",
              domain: null,
              industry: null,
              phone: null,
              city: null,
              country: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Renovación 2027");
    await waitFor(() => expect(screen.getByLabelText("Empresa")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText("Buscar por nombre…"), "acme");

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    await screen.findByRole("combobox", { name: "Proceso de venta" });
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");

    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de oportunidades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({
      title: "Renovación 2027",
      companyId: "co1",
      pipelineId: "pl1",
      stageId: "st1",
      status: "OPEN",
      currency: "USD",
    });
  });

  // El "+ Añadir" de una columna del embudo llega con pipelineId y stageId
  // en la query string (OpportunityBoardView): el formulario los toma como
  // valor inicial en creación, y siguen siendo editables.
  it("create: ?pipelineId&stageId preseleccionan Pipeline y Etapa", async () => {
    let postedBody: unknown;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl2&stageId=st2");

    await waitFor(() => expect(screen.getByLabelText("Proceso de venta")).toHaveValue("Postventa"));
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Cierre"));

    await user.type(screen.getByLabelText("Título"), "Desde el embudo");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de oportunidades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ pipelineId: "pl2", stageId: "st2" });
  });

  // Ítem 7 de docs/frontend-cambios-pendientes.md: mismo contrato que
  // Company y Contact — el usuario actual ya está marcado, la antigua opción
  // "Asignado a quien crea (por defecto)" no existe más, y el id viaja
  // explícito en el POST (resolveOwnerId haría lo mismo si no se mandara).
  it("create: Asignado arranca preseleccionado en quien crea, sin opción 'por defecto', y viaja en el POST", async () => {
    let postedBody: unknown;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl1&stageId=st1");

    await waitFor(() => expect(screen.getByLabelText("Asignado")).toHaveValue("Ana Pérez"));
    // Abrir el panel muestra solo usuarios: ninguna fila vacía.
    expect(await listSelectOptions(user, screen.getByLabelText("Asignado"))).toEqual(["Ana Pérez"]);
    await user.keyboard("{Escape}");

    await user.type(screen.getByLabelText("Título"), "Con dueño actual");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de oportunidades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ title: "Con dueño actual", ownerId: "u1" });
  });

  it("create: falta Company y Contact → se muestra el mensaje real del backend, no navega", async () => {
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, () =>
        HttpResponse.json(
          { error: { message: "Debe indicar companyId, contactId, o ambos" } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Sin relación");
    // Pipeline y Etapa se exigen en el cliente desde el ítem 10 de
    // docs/frontend-cambios-pendientes.md (test de abajo): hay que elegirlos
    // para que el submit llegue al backend y sea SU mensaje el que se muestre.
    await screen.findByRole("combobox", { name: "Proceso de venta" });
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Debe indicar companyId, contactId, o ambos",
      ),
    );
    expect(screen.queryByText("lista de oportunidades")).not.toBeInTheDocument();
  });

  // Ítem 10 de docs/frontend-cambios-pendientes.md: Pipeline y Etapa llevan
  // la marca de obligatorio y `required` en sus <select>, así que el click en
  // Guardar lo frena el navegador (y jsdom) sin llegar a handleSubmit. Si el
  // submit igual llega —mientras una lista carga no hay <select> que validar,
  // y el de Etapa está deshabilitado sin pipeline—, el chequeo propio de
  // handleSubmit corta con su mensaje. En ningún caso hay POST: el asterisco
  // no miente.
  it("create: sin Pipeline/Etapa no hay POST — marca + required nativo en el click, chequeo propio si el submit igual llega", async () => {
    let posted = false;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, () => {
        posted = true;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Sin embudo");
    const pipeline = await screen.findByLabelText("Proceso de venta");
    expect(pipeline).toBeRequired();
    expect(screen.getByText("Proceso de venta")).toHaveClass("ds-required");
    expect(screen.getByLabelText("Etapa")).toBeRequired();
    expect(screen.getByText("Etapa")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /guardar/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(posted).toBe(false);

    const form = pipeline.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Elegí un proceso de venta antes de guardar.",
      ),
    );

    await chooseSelectOption(user, pipeline, "Ventas");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Elegí una etapa antes de guardar."),
    );
    expect(posted).toBe(false);
    expect(screen.queryByText("lista de oportunidades")).not.toBeInTheDocument();
  });

  it("edit: hidrata todos los campos correctamente (amount, fechas slice(0,10), lostReason, relaciones)", async () => {
    const user = userEvent.setup();
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeOpportunity({
            id: params.id as string,
            title: "Renovación original",
            amount: "1234.50",
            currency: "ARS",
            status: "LOST",
            lostReason: "Precio",
            companyId: null,
            contactId: null,
            pipelineId: "pl1",
            stageId: "st1",
            ownerId: "u1",
            expectedCloseDate: "2026-08-15T00:00:00.000Z",
            actualCloseDate: "2026-08-20T00:00:00.000Z",
          }),
        ),
      ),
    );
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Título")).toHaveValue("Renovación original"));
    // Ítem 18.A: el monto se ve ya formateado (estilo Uruguay, 2 decimales).
    expect(screen.getByLabelText("Monto")).toHaveValue("1.234,50");
    // Ítem 18.B: "ARS" no está en la lista USD/UYU, pero es el valor
    // persistido — se muestra como opción extra mientras sea el vigente, en
    // vez de un select que dice "USD" y un PATCH que manda "ARS".
    expect(screen.getByLabelText("Moneda")).toHaveValue("ARS");
    expect(await listSelectOptions(user, screen.getByLabelText("Moneda"))).toEqual([
      "ARS",
      "USD",
      "UYU",
    ]);
    expect(screen.getByLabelText("Estado")).toHaveTextContent("Perdida");
    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio");
    expect(screen.getByLabelText("Fecha estimada de cierre")).toHaveValue("2026-08-15");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");
    await waitFor(() => expect(screen.getByLabelText("Proceso de venta")).toHaveValue("Ventas"));
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Prospecto"));
  });

  // -------------------------------------------------------------------------
  // Estado y cierre (ítems 18.E y 18.F, más §50 y §51 de
  // docs/frontend-cambios-pendientes.md).
  //
  // Reemplaza a propósito la decisión de M5 ("lostReason siempre visible,
  // status nunca lo toca"): Motivo de pérdida y Fecha real de cierre solo se
  // ven con Ganada/Perdida, cerrar completa la fecha con hoy si estaba vacía,
  // y reabrir limpia los dos.
  //
  // Desde §51 el cierre se vive CAMBIANDO LA ETAPA y no con un selector de
  // Estado: ese selector se sacó porque permitía guardar Etapa y Estado
  // contradictorios entre sí (etapa marcada "Perdida" + Estado "Ganada"). El
  // Estado quedó como texto de solo lectura, así que se afirma con
  // toHaveTextContent en vez de toHaveValue, y con la oportunidad abierta la
  // tarjeta entera no existe en ninguno de los dos modos.
  //
  // La regla de sincronización pura tiene sus propios casos en
  // stageStatus.test.ts; acá se prueba qué hace el formulario con Motivo y
  // Fecha real alrededor de ella.
  // -------------------------------------------------------------------------

  // En edición el Proceso de venta ya viene elegido, así que para cerrar o
  // reabrir alcanza con mover la Etapa. Esperar a que el selector esté
  // habilitado es esperar a que su lista haya cargado: StageSelect no monta
  // el combobox mientras la query está en vuelo (ver StageSelect.tsx).
  async function chooseEtapa(user: ReturnType<typeof userEvent.setup>, etapa: string) {
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), etapa);
  }

  it("edit: la tarjeta de Estado y cierre no existe con la oportunidad abierta; una Etapa marcada la trae, con Motivo solo en Perdida y Fecha real en las dos", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(makeOpportunity({ status: "OPEN", pipelineId: "pl1", stageId: "st1" })),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    // Abierta: §51 unificó el gate de la tarjeta con el de Alta, así que acá
    // no hay ni Estado a la vista.
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Prospecto"));
    expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha real de cierre")).not.toBeInTheDocument();

    await chooseEtapa(user, "Cierre ganado");
    expect(await screen.findByLabelText("Estado")).toHaveTextContent("Ganada");
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Fecha real de cierre")).toBeVisible();

    await chooseEtapa(user, "Cierre perdido");
    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveTextContent("Perdida"));
    expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
    expect(screen.getByLabelText("Fecha real de cierre")).toBeVisible();

    await chooseEtapa(user, "Prospecto");
    await waitFor(() => expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha real de cierre")).not.toBeInTheDocument();
  });

  it.each([
    ["LOST", "Cierre perdido", "Perdida"],
    ["WON", "Cierre ganado", "Ganada"],
  ])(
    "edit: cerrar como %s eligiendo una Etapa marcada, con Fecha real vacía, la completa con hoy, y sigue editable",
    async (status, etapa, label) => {
      let patchedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.get(`${opportunitiesUrl}/:id`, () =>
          HttpResponse.json(
            makeOpportunity({
              status: "OPEN",
              actualCloseDate: null,
              pipelineId: "pl1",
              stageId: "st1",
            }),
          ),
        ),
        http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
          patchedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity());
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/op1/edit");

      await chooseEtapa(user, etapa);
      expect(await screen.findByLabelText("Estado")).toHaveTextContent(label);

      const fechaReal = screen.getByLabelText("Fecha real de cierre");
      expect(fechaReal).toHaveValue(todayIsoDate());
      expect(fechaReal).toBeEnabled();

      // Es solo un valor inicial: se puede cambiar a mano después.
      await user.clear(fechaReal);
      await user.type(fechaReal, "2026-03-01");
      expect(fechaReal).toHaveValue("2026-03-01");
      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(patchedBody).toBeDefined());
      expect(patchedBody).toMatchObject({ status, actualCloseDate: "2026-03-01" });
    },
  );

  it("edit: si Fecha real ya tenía valor, cerrar por una Etapa marcada no lo pisa (ni Abierta → Perdida, ni Perdida → Ganada)", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            status: "OPEN",
            actualCloseDate: "2026-08-20T00:00:00.000Z",
            pipelineId: "pl1",
            stageId: "st1",
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await chooseEtapa(user, "Cierre perdido");
    expect(await screen.findByLabelText("Estado")).toHaveTextContent("Perdida");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");

    await chooseEtapa(user, "Cierre ganado");
    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveTextContent("Ganada"));
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");
  });

  // Que reabrir limpie Motivo y Fecha real y los mande como null ya lo cubre
  // el describe de §50 ("de una Etapa marcada isLost a una normal reabre…").
  // Lo que falta probar es lo de después: volver a cerrar no arrastra nada del
  // cierre anterior.
  it("edit: reabrir con una Etapa normal y volver a cerrar arranca limpio (sin el motivo viejo, con la fecha de hoy)", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            status: "LOST",
            lostReason: "Precio muy alto",
            actualCloseDate: "2026-08-20T00:00:00.000Z",
            pipelineId: "pl1",
            stageId: "st-perdida",
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio muy alto"),
    );

    await chooseEtapa(user, "Prospecto");
    await waitFor(() => expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument());

    await chooseEtapa(user, "Cierre perdido");
    expect(await screen.findByLabelText("Estado")).toHaveTextContent("Perdida");
    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue(todayIsoDate());
  });

  it("edit: pasar de una Etapa perdida a una ganada limpia lostReason y el PATCH lo manda como null", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            status: "LOST",
            lostReason: "Precio",
            actualCloseDate: "2026-08-20T00:00:00.000Z",
            pipelineId: "pl1",
            stageId: "st-perdida",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio"));
    await chooseEtapa(user, "Cierre ganado");
    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveTextContent("Ganada"));
    // El campo desaparece: un motivo de pérdida en una oportunidad ganada no
    // tiene sentido, y el valor viejo no puede quedar viajando fantasma.
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toMatchObject({
      stageId: "st-ganada",
      status: "WON",
      lostReason: null,
      actualCloseDate: "2026-08-20",
    });
  });

  it("limpiar lostReason explícitamente y guardar envía lostReason: null", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            status: "LOST",
            lostReason: "Precio",
            pipelineId: "pl1",
            stageId: "st1",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio"));
    await user.clear(screen.getByLabelText("Motivo de pérdida"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.lostReason).toBeNull();
  });

  it("limpiar expectedCloseDate/actualCloseDate en edición envía null explícito", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          // status WON: desde el ítem 18.F Fecha real solo se ve con
          // Ganada/Perdida.
          makeOpportunity({
            id: "op1",
            status: "WON",
            pipelineId: "pl1",
            stageId: "st1",
            expectedCloseDate: "2026-08-15T00:00:00.000Z",
            actualCloseDate: "2026-08-20T00:00:00.000Z",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Fecha estimada de cierre")).toHaveValue("2026-08-15"),
    );
    await user.clear(screen.getByLabelText("Fecha estimada de cierre"));
    await user.clear(screen.getByLabelText("Fecha real de cierre"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.expectedCloseDate).toBeNull();
    expect(patchedBody?.actualCloseDate).toBeNull();
  });

  it("dejar expectedCloseDate/actualCloseDate vacíos en creación los omite del payload", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Nueva");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).not.toHaveProperty("expectedCloseDate");
    expect(postedBody).not.toHaveProperty("actualCloseDate");
  });

  it("create: una fecha con valor se envía como 'YYYY-MM-DD', nunca como ISO completo con hora", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Nueva");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.type(screen.getByLabelText("Fecha estimada de cierre"), "2026-08-15");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.expectedCloseDate).toBe("2026-08-15");
  });

  it("cambiar Pipeline limpia Stage (StageSelect vuelve a quedar sin selección)", async () => {
    server.use(...baseHandlers());
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await waitFor(() => expect(screen.getByLabelText("Proceso de venta")).toBeInTheDocument());
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    expect(screen.getByLabelText("Etapa")).toHaveValue("Prospecto");

    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Postventa");

    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    expect(screen.getByLabelText("Etapa")).toHaveValue("");
  });

  // §50: elegir una Etapa sincroniza el Estado con la misma regla que el
  // embudo al arrastrar (stageStatus.ts, compartido con boardMove.ts). Desde
  // §51 es el único camino: el selector de Estado editable a mano ya no
  // existe, el Estado se muestra como texto y la tarjeta "Estado y cierre"
  // aparece solo con la oportunidad cerrada, también en Edición.
  describe("la Etapa gobierna el Estado (§50, §51)", () => {
    async function chooseVentasY(user: ReturnType<typeof userEvent.setup>, etapa: string) {
      await screen.findByRole("combobox", { name: "Proceso de venta" });
      await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
      await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
      await chooseSelectOption(user, screen.getByLabelText("Etapa"), etapa);
    }

    it("create: una Etapa marcada isLost muestra la tarjeta de Estado con Perdida y Motivo, y el POST manda LOST", async () => {
      let postedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.post(opportunitiesUrl, async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity(), { status: 201 });
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/new");

      // En Alta la tarjeta no existe hasta que una etapa cierra la
      // oportunidad — es el gate nuevo de §50.
      expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();

      await user.type(screen.getByLabelText("Título"), "Se perdió de entrada");
      await chooseVentasY(user, "Cierre perdido");

      expect(await screen.findByLabelText("Estado")).toHaveTextContent("Perdida");
      expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
      expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue(todayIsoDate());

      await user.type(screen.getByLabelText("Motivo de pérdida"), "Compró en otro lado");
      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(postedBody).toBeDefined());
      expect(postedBody).toMatchObject({
        stageId: "st-perdida",
        status: "LOST",
        lostReason: "Compró en otro lado",
        actualCloseDate: todayIsoDate(),
      });
    });

    it("create: una Etapa marcada isWon muestra Ganada y Fecha real, sin Motivo", async () => {
      let postedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.post(opportunitiesUrl, async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity(), { status: 201 });
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/new");

      await user.type(screen.getByLabelText("Título"), "Cerrada al toque");
      await chooseVentasY(user, "Cierre ganado");

      expect(await screen.findByLabelText("Estado")).toHaveTextContent("Ganada");
      expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue(todayIsoDate());
      expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(postedBody).toBeDefined());
      expect(postedBody).toMatchObject({
        stageId: "st-ganada",
        status: "WON",
        actualCloseDate: todayIsoDate(),
      });
    });

    it("create: volver a una Etapa normal hace desaparecer la tarjeta y el POST vuelve a OPEN", async () => {
      let postedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.post(opportunitiesUrl, async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity(), { status: 201 });
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/new");

      await user.type(screen.getByLabelText("Título"), "Falsa alarma");
      await chooseVentasY(user, "Cierre perdido");
      await user.type(await screen.findByLabelText("Motivo de pérdida"), "Precio");

      await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
      await waitFor(() => expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument());

      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(postedBody).toBeDefined());
      expect(postedBody).toMatchObject({ stageId: "st1", status: "OPEN" });
      // Reabrir limpia motivo y fecha; en create los vacíos ni se mandan.
      expect(postedBody).not.toHaveProperty("lostReason");
      expect(postedBody).not.toHaveProperty("actualCloseDate");
    });

    it("edit: cambiar la Etapa a una marcada isLost trae la tarjeta cerrada, con Estado Perdida y Motivo de pérdida", async () => {
      server.use(
        ...baseHandlers(),
        http.get(`${opportunitiesUrl}/:id`, () =>
          HttpResponse.json(
            makeOpportunity({
              status: "OPEN",
              actualCloseDate: null,
              pipelineId: "pl1",
              stageId: "st1",
            }),
          ),
        ),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/op1/edit");

      await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Prospecto"));
      expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();

      await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Cierre perdido");

      await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveTextContent("Perdida"));
      expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
      expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue(todayIsoDate());
    });

    it("edit: de una Etapa marcada isLost a una normal reabre y el PATCH manda OPEN con motivo y fecha en null", async () => {
      let patchedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.get(`${opportunitiesUrl}/:id`, () =>
          HttpResponse.json(
            makeOpportunity({
              id: "op1",
              status: "LOST",
              lostReason: "Precio muy alto",
              actualCloseDate: "2026-08-20T00:00:00.000Z",
              pipelineId: "pl1",
              stageId: "st-perdida",
            }),
          ),
        ),
        http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
          patchedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity());
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/op1/edit");

      await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Cierre perdido"));
      expect(screen.getByLabelText("Estado")).toHaveTextContent("Perdida");

      await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");

      await waitFor(() => expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument());
      expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Fecha real de cierre")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(patchedBody).toBeDefined());
      expect(patchedBody).toMatchObject({
        stageId: "st1",
        status: "OPEN",
        lostReason: null,
        actualCloseDate: null,
      });
    });

    it("edit: cambiar de Proceso de venta estando cerrada por una Etapa también reabre", async () => {
      let patchedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.get(`${opportunitiesUrl}/:id`, () =>
          HttpResponse.json(
            makeOpportunity({
              id: "op1",
              status: "LOST",
              lostReason: "Precio muy alto",
              actualCloseDate: "2026-08-20T00:00:00.000Z",
              pipelineId: "pl1",
              stageId: "st-perdida",
            }),
          ),
        ),
        http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
          patchedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity());
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/op1/edit");

      await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveTextContent("Perdida"));

      await screen.findByRole("combobox", { name: "Proceso de venta" });
      await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Postventa");

      await waitFor(() => expect(screen.queryByLabelText("Estado")).not.toBeInTheDocument());
      expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();

      // La etapa quedó limpia al cambiar de proceso: hay que elegir una nueva
      // para poder guardar (chequeo propio de handleSubmit).
      await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
      await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Cierre");
      await user.click(screen.getByRole("button", { name: /guardar/i }));

      await waitFor(() => expect(patchedBody).toBeDefined());
      expect(patchedBody).toMatchObject({
        pipelineId: "pl2",
        stageId: "st2",
        status: "OPEN",
        lostReason: null,
        actualCloseDate: null,
      });
    });

    // El punto delicado: la sincronización es una reacción a que ALGUIEN
    // cambie la Etapa, no una corrección automática. Un registro histórico
    // cuyo Estado no coincide con los flags de su Etapa se muestra tal cual
    // está persistido — recalcularlo al abrir la edición sería reescribir
    // datos que nadie pidió tocar.
    it("edit: la carga inicial NO recalcula nada — Etapa isLost con status WON persistido sigue mostrando Ganada", async () => {
      let patchedBody: Record<string, unknown> | undefined;
      server.use(
        ...baseHandlers(),
        http.get(`${opportunitiesUrl}/:id`, () =>
          HttpResponse.json(
            makeOpportunity({
              id: "op1",
              status: "WON",
              actualCloseDate: "2026-08-20T00:00:00.000Z",
              pipelineId: "pl1",
              stageId: "st-perdida",
            }),
          ),
        ),
        http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
          patchedBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(makeOpportunity());
        }),
      );
      const user = userEvent.setup();
      renderForm("/opportunities/op1/edit");

      // Se espera a que la lista de etapas haya cargado (el selector muestra
      // el nombre, no el id): recién ahí los flags estarían disponibles para
      // recalcular, y justamente no se recalcula.
      await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("Cierre perdido"));
      expect(screen.getByLabelText("Estado")).toHaveTextContent("Ganada");
      expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");

      // Y guardar sin tocar nada conserva el estado persistido.
      await user.click(screen.getByRole("button", { name: /guardar/i }));
      await waitFor(() => expect(patchedBody).toBeDefined());
      expect(patchedBody).toMatchObject({ stageId: "st-perdida", status: "WON" });
    });
  });

  it("Company y Contact son independientes: elegir Company primero NO filtra la búsqueda de Contact, y cambiar Company no modifica el Contact ya elegido", async () => {
    const capturedContactRequests: URL[] = [];
    server.use(
      ...baseHandlers(),
      http.get(`${env.apiUrl}/api/contacts`, ({ request }) => {
        capturedContactRequests.push(new URL(request.url));
        return HttpResponse.json({
          data: [
            {
              id: "ct1",
              organizationId: "org-1",
              companyId: null,
              ownerId: null,
              firstName: "Ana",
              lastName: "Pérez",
              email: null,
              phone: null,
              jobTitle: null,
              lifecycleStage: "LEAD",
              source: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
      http.get(`${env.apiUrl}/api/companies`, () =>
        HttpResponse.json({
          data: [
            {
              id: "co1",
              organizationId: "org-1",
              ownerId: null,
              name: "Acme Corp",
              domain: null,
              industry: null,
              phone: null,
              city: null,
              country: null,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              deletedAt: null,
            },
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      // CompanySelect siembra companyKeys.detail("co1") desde el resultado
      // de búsqueda, pero staleTime por defecto es 0 en el queryClient de
      // test — useCompany("co1") igual puede disparar un refetch de fondo
      // una vez que `value` queda seteado (comportamiento estándar de
      // TanStack Query ante datos "stale", no algo introducido en M5).
      http.get(`${env.apiUrl}/api/companies/co1`, () =>
        HttpResponse.json({
          id: "co1",
          organizationId: "org-1",
          ownerId: null,
          name: "Acme Corp",
          domain: null,
          industry: null,
          phone: null,
          city: null,
          country: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
        }),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    // El texto "Seleccionado: Ana Pérez" queda partido en varios nodos de
    // texto dentro del mismo <p> ("Seleccionado:", " ", "Ana Pérez") — un
    // matcher de función es la forma correcta de verificarlo (sugerida por
    // Testing Library ante ese caso), en vez de un string/regex simple.
    function selectedContactParagraph() {
      return screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "p" &&
          (element.textContent ?? "").replace(/\s+/g, " ").trim() === "Seleccionado: Ana Pérez",
      );
    }

    // 1) Elegir Company PRIMERO.
    await user.type(screen.getByPlaceholderText("Buscar por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    // 2) Buscar Contact CON una Company ya elegida — la request a
    // /contacts nunca debe incluir companyId (ContactSelect es
    // deliberadamente independiente, ver ContactSelect.tsx).
    // getByRole("button", ...) en vez de getByText: UserSelect (siempre
    // montado en este form) también puede tener una <option>Ana Pérez
    // </option> con el mismo texto — el resultado de búsqueda de
    // ContactSelect es inequívocamente un <button>, la opción no lo es.
    await user.type(screen.getByPlaceholderText("Buscar por nombre o email…"), "ana");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Ana Pérez" })).toBeInTheDocument(),
    );
    expect(capturedContactRequests.length).toBeGreaterThan(0);
    for (const req of capturedContactRequests) {
      expect(req.searchParams.has("companyId")).toBe(false);
    }
    await user.click(screen.getByRole("button", { name: "Ana Pérez" }));
    await waitFor(() => expect(selectedContactParagraph()).toBeInTheDocument());

    // 3) Cambiar Company de nuevo NO debe tocar el Contact ya elegido.
    await user.clear(screen.getByPlaceholderText("Buscar por nombre…"));
    await user.type(screen.getByPlaceholderText("Buscar por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    expect(selectedContactParagraph()).toBeInTheDocument();
  });

  // Ítem 18.A: el input formatea en vivo estilo Uruguay (miles con punto,
  // coma decimal; el punto tipeado se toma como coma) y el payload sigue
  // llevando el número real, sin puntos ni comas. Al salir del campo se
  // completan los 2 decimales.
  it("amount: se formatea en vivo al tipear ('20000,5' → '20.000,5', '20.000,50' al salir) y viaja como number", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Nueva");
    const monto = screen.getByLabelText("Monto");
    expect(monto).toHaveAttribute("inputmode", "decimal");
    await user.type(monto, "20000,5");
    expect(monto).toHaveValue("20.000,5");
    await user.tab();
    expect(monto).toHaveValue("20.000,50");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.amount).toBe(20000.5);
    expect(typeof postedBody?.amount).toBe("number");
  });

  it("amount: un punto tipeado como decimal ('2500.75') se lee como coma y envía 2500.75", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Nueva");
    await user.type(screen.getByLabelText("Monto"), "2500.75");
    expect(screen.getByLabelText("Monto")).toHaveValue("2.500,75");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.amount).toBe(2500.75);
    expect(typeof postedBody?.amount).toBe("number");
  });

  it("error de detail muestra error y no presenta el form como create vacío", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "no existe" } }, { status: 404 }),
      ),
    );
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("no existe"));
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
  });

  it("error de mutation se muestra visible y no navega", async () => {
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, () =>
        HttpResponse.json(
          { error: { message: "El stageId indicado no pertenece al pipeline especificado" } },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Nueva");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El stageId indicado no pertenece al pipeline especificado",
      ),
    );
    expect(screen.queryByText("lista de oportunidades")).not.toBeInTheDocument();
  });

  // Ítem 18.B: Moneda es un <select> cerrado USD/UYU (sin "Otra"), que
  // arranca en USD. La restricción es solo del cliente: el backend sigue
  // aceptando cualquier ISO 4217.
  it("create: Moneda es un select cerrado con USD y UYU, arranca en USD, y el POST manda la elegida", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl1&stageId=st1");

    // Desde §46 es el combobox del design system (un input con role
    // combobox), pero sigue siendo una lista cerrada: solo USD y UYU.
    const moneda = screen.getByLabelText("Moneda");
    expect(moneda).toHaveValue("USD");
    expect(await listSelectOptions(user, moneda)).toEqual(["USD", "UYU"]);

    await user.type(screen.getByLabelText("Título"), "En pesos");
    await chooseSelectOption(user, moneda, "UYU");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).toMatchObject({ currency: "UYU" });
  });

  // Ítem 18.C: "Fecha desconocida" vacía y deshabilita Fecha estimada de
  // cierre; destildar la vuelve a habilitar. Sin cambio de modelo: vacío y
  // desconocida son lo mismo para la API (el POST omite el campo).
  it("create: 'Fecha desconocida' vacía y deshabilita Fecha estimada; destildar la habilita de nuevo", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl1&stageId=st1");

    const fecha = screen.getByLabelText("Fecha estimada de cierre");
    const desconocida = screen.getByLabelText("Fecha desconocida");
    expect(desconocida).not.toBeChecked();
    expect(fecha).toBeEnabled();

    await user.type(fecha, "2026-08-15");
    expect(fecha).toHaveValue("2026-08-15");

    await user.click(desconocida);
    expect(desconocida).toBeChecked();
    expect(fecha).toHaveValue("");
    expect(fecha).toBeDisabled();

    await user.type(screen.getByLabelText("Título"), "Sin fecha");
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).not.toHaveProperty("expectedCloseDate");
  });

  it("'Fecha desconocida' destildada vuelve a habilitar el campo y deja cargar una fecha", async () => {
    server.use(...baseHandlers());
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    const fecha = screen.getByLabelText("Fecha estimada de cierre");
    const desconocida = screen.getByLabelText("Fecha desconocida");

    await user.click(desconocida);
    expect(fecha).toBeDisabled();

    await user.click(desconocida);
    expect(desconocida).not.toBeChecked();
    expect(fecha).toBeEnabled();
    await user.type(fecha, "2026-09-30");
    expect(fecha).toHaveValue("2026-09-30");
  });

  // -------------------------------------------------------------------------
  // Vehículo vinculado (Fase 3b). EL PUNTO DELICADO: el backend copia el
  // precio de la unidad SOLO si el body no manda amount ni currency, así que
  // vincular tiene que vaciar Monto/Moneda y el submit tiene que omitirlos.
  // -------------------------------------------------------------------------

  it("create: vincular una unidad vacía Monto y Moneda, muestra el aviso, y el POST manda vehicleId (más financiación y origen) SIN amount ni currency", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      ...vehicleHandlers("AVAILABLE"),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    // Antes de vincular: Moneda arranca en USD y no hay aviso.
    expect(screen.getByLabelText("Moneda")).toHaveValue("USD");
    expect(screen.queryByText(PRICE_HINT)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Título"), "Corolla para Ana");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");

    await user.type(screen.getByPlaceholderText(VEHICLE_PLACEHOLDER), "corolla");
    await user.click(
      await screen.findByRole("button", { name: "Toyota Corolla 2020 · 25000.00 USD" }),
    );

    expect(screen.getByLabelText("Monto")).toHaveValue("");
    // Ítem 18.B: mientras Moneda está vacía por el vínculo, el control
    // cerrado dice "Según la unidad" para no mentir con "USD". Desde §46 ese
    // texto es el placeholder del combobox (la fila vacía), no una <option>.
    expect(screen.getByLabelText("Moneda")).toHaveValue("");
    expect(screen.getByLabelText("Moneda")).toHaveAttribute("placeholder", "Según la unidad");
    expect(screen.getByText(PRICE_HINT)).toBeInTheDocument();

    await chooseSelectOption(
      user,
      screen.getByLabelText("Financiación"),
      "Crédito prendario 24 meses",
    );
    await chooseSelectOption(user, screen.getByLabelText("Origen del cliente"), "WhatsApp");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).toMatchObject({
      vehicleId: "v1",
      financingType: "INSTALLMENT_24M",
      leadSource: "WHATSAPP",
    });
    expect(postedBody).not.toHaveProperty("amount");
    expect(postedBody).not.toHaveProperty("currency");
  });

  it("create: tipear Monto y Moneda DESPUÉS de vincular es un override explícito — el aviso desaparece y el POST los manda", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      ...vehicleHandlers("AVAILABLE"),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await user.type(screen.getByLabelText("Título"), "Con precio propio");
    await chooseSelectOption(user, screen.getByLabelText("Proceso de venta"), "Ventas");
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toBeEnabled());
    await chooseSelectOption(user, screen.getByLabelText("Etapa"), "Prospecto");
    await user.type(screen.getByPlaceholderText(VEHICLE_PLACEHOLDER), "corolla");
    await user.click(
      await screen.findByRole("button", { name: "Toyota Corolla 2020 · 25000.00 USD" }),
    );
    expect(screen.getByText(PRICE_HINT)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Monto"), "23500");
    expect(screen.queryByText(PRICE_HINT)).not.toBeInTheDocument();
    await chooseSelectOption(user, screen.getByLabelText("Moneda"), "UYU");
    // Elegida una moneda real, "Según la unidad" desaparece.
    expect(
      within(screen.getByLabelText("Moneda")).queryByRole("option", { name: "Según la unidad" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).toMatchObject({ vehicleId: "v1", amount: 23500, currency: "UYU" });
  });

  it("edit: arranca con la unidad persistida (RESERVED, con badge) SIN vaciar Monto/Moneda; 'Quitar vínculo' manda vehicleId: null y conserva el monto", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      ...vehicleHandlers("RESERVED"),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            amount: "1234.50",
            currency: "ARS",
            pipelineId: "pl1",
            stageId: "st1",
            vehicleId: "v1",
            financingType: "OWN_FINANCING",
            leadSource: "SHOWROOM",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() =>
      expect(screen.getByText(/Toyota Corolla 2020 · 25000.00 USD/)).toBeVisible(),
    );
    expect(screen.getByText("Reservado")).toHaveClass("ds-badge--info");
    // La unidad con la que arrancó el form no es "nueva": nada se vacía y no
    // hay aviso.
    expect(screen.getByLabelText("Monto")).toHaveValue("1.234,50");
    expect(screen.getByLabelText("Moneda")).toHaveValue("ARS");
    expect(screen.queryByText(PRICE_HINT)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Financiación")).toHaveValue("Financiación propia");
    expect(screen.getByLabelText("Origen del cliente")).toHaveValue("Showroom");

    await user.click(screen.getByRole("button", { name: "Quitar vínculo" }));
    expect(screen.queryByText("Quitar vínculo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.vehicleId).toBeNull();
    expect(patchedBody).toMatchObject({
      amount: 1234.5,
      currency: "ARS",
      financingType: "OWN_FINANCING",
      leadSource: "SHOWROOM",
    });
  });

  it("edit: cambiar de unidad vacía Monto/Moneda y el PATCH manda el vehicleId nuevo sin amount ni currency; financiación y origen vacíos van como null", async () => {
    const patched: Record<string, unknown>[] = [];
    server.use(
      ...baseHandlers(),
      ...vehicleHandlers("RESERVED"),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            amount: "1234.50",
            currency: "ARS",
            pipelineId: "pl1",
            stageId: "st1",
            vehicleId: "v1",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patched.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByText(/Toyota Corolla 2020/)).toBeVisible());
    await user.type(screen.getByPlaceholderText(VEHICLE_PLACEHOLDER), "ranger");
    await user.click(
      await screen.findByRole("button", { name: "Ford Ranger 2020 · 40000.00 USD" }),
    );

    expect(screen.getByLabelText("Monto")).toHaveValue("");
    expect(screen.getByLabelText("Moneda")).toHaveValue("");
    expect(screen.getByText(PRICE_HINT)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Ford Ranger 2020 · 40000.00 USD/)).toBeVisible());

    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(patched.length).toBe(1));
    expect(patched[0]).toMatchObject({ vehicleId: "v2", financingType: null, leadSource: null });
    expect(patched[0]).not.toHaveProperty("amount");
    expect(patched[0]).not.toHaveProperty("currency");
  });

  // §42: detalle del plan de financiación, visible solo con una financiación
  // elegida (ni "Sin especificar" ni "Sin financiación").
  const FINANCING_DETAIL_LABELS = [
    "Entidad financiera",
    "Entrega inicial",
    "Cantidad de cuotas",
    "Monto de cuota",
  ];

  it("§42 create: el detalle de financiación no aparece sin financiación ni con 'Sin financiación'; con Cuotas sí, y el POST manda lo cargado", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl1&stageId=st1");

    const financiacion = await screen.findByLabelText("Financiación");
    for (const label of FINANCING_DETAIL_LABELS) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }

    await chooseSelectOption(user, financiacion, "Sin financiación");
    for (const label of FINANCING_DETAIL_LABELS) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }

    await chooseSelectOption(user, financiacion, "Crédito prendario 24 meses");
    for (const label of FINANCING_DETAIL_LABELS) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }

    await user.type(screen.getByLabelText("Título"), "Con plan");
    await user.type(screen.getByLabelText("Entidad financiera"), "Banco República");
    await user.type(screen.getByLabelText("Entrega inicial"), "5000");
    await user.type(screen.getByLabelText("Cantidad de cuotas"), "23");
    await user.type(screen.getByLabelText("Monto de cuota"), "812,25");
    // Ya salió del campo: CurrencyInput lo muestra con los dos decimales.
    expect(screen.getByLabelText("Entrega inicial")).toHaveValue("5.000,00");

    // Sin Empresa ni Contacto el backend real respondería 400; acá lo que
    // importa es el payload, y el handler lo acepta igual.
    await user.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody).toMatchObject({
      financingType: "INSTALLMENT_24M",
      financingLender: "Banco República",
      financingDownPayment: 5000,
      financingInstallmentCount: 23,
      financingInstallmentAmount: 812.25,
    });
  });

  it("§42 create: sin tocar el detalle, el POST no manda ninguno de los cuatro campos", async () => {
    let postedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.post(opportunitiesUrl, async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity(), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/new?pipelineId=pl1&stageId=st1");

    await chooseSelectOption(
      user,
      await screen.findByLabelText("Financiación"),
      "Financiación propia",
    );
    await user.type(screen.getByLabelText("Título"), "Sin plan");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    for (const campo of [
      "financingLender",
      "financingDownPayment",
      "financingInstallmentCount",
      "financingInstallmentAmount",
    ]) {
      expect(postedBody).not.toHaveProperty(campo);
    }
  });

  it("§42 edit: hidrata el detalle persistido, el PATCH manda lo corregido y un campo vaciado va como null", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            pipelineId: "pl1",
            stageId: "st1",
            financingType: "INSTALLMENT_36M",
            financingLender: "Banco República",
            financingDownPayment: "5000.50",
            financingInstallmentCount: 36,
            financingInstallmentAmount: "812.25",
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() =>
      expect(screen.getByLabelText("Entidad financiera")).toHaveValue("Banco República"),
    );
    expect(screen.getByLabelText("Entrega inicial")).toHaveValue("5.000,50");
    expect(screen.getByLabelText("Cantidad de cuotas")).toHaveValue(36);
    expect(screen.getByLabelText("Monto de cuota")).toHaveValue("812,25");

    await user.clear(screen.getByLabelText("Cantidad de cuotas"));
    await user.type(screen.getByLabelText("Cantidad de cuotas"), "35");
    await user.clear(screen.getByLabelText("Entidad financiera"));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toMatchObject({
      financingType: "INSTALLMENT_36M",
      financingLender: null,
      financingDownPayment: 5000.5,
      financingInstallmentCount: 35,
      financingInstallmentAmount: 812.25,
    });
  });

  it("§42 edit: pasar a 'Sin financiación' oculta el detalle pero no lo vacía — el PATCH lo reenvía tal cual", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            id: "op1",
            pipelineId: "pl1",
            stageId: "st1",
            financingType: "OWN_FINANCING",
            financingDownPayment: "0.00",
            financingInstallmentCount: 12,
          }),
        ),
      ),
      http.patch(`${opportunitiesUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Cantidad de cuotas")).toHaveValue(12));
    await chooseSelectOption(user, screen.getByLabelText("Financiación"), "Sin financiación");
    for (const label of FINANCING_DETAIL_LABELS) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toMatchObject({
      financingType: "NONE",
      financingLender: null,
      // Una entrega inicial de 0 es un valor real: no se confunde con vacío.
      financingDownPayment: 0,
      financingInstallmentCount: 12,
      financingInstallmentAmount: null,
    });
  });

  it("edit: debajo del formulario se monta la sección de Cotización de ESA oportunidad, con la activa y su historial", async () => {
    let pedida: string | null = null;
    // El handler de quotes va ANTES de baseHandlers(): en MSW gana el primero
    // que matchea, y baseHandlers() trae uno vacío.
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeOpportunity({ id: params.id as string })),
      ),
      http.get(quotesUrl, ({ request }) => {
        pedida = new URL(request.url).searchParams.get("opportunityId");
        return HttpResponse.json(
          makeQuoteList(
            [
              makeQuote({ id: "q2", opportunityId: "op1", status: "SENT" }),
              makeQuote({ id: "q1", opportunityId: "op1", status: "SUPERSEDED" }),
            ],
            "q2",
          ),
        );
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    const cotizacion = await screen.findByRole("region", { name: "Cotización" });
    expect(await within(cotizacion).findByText("Enviada")).toBeInTheDocument();
    expect(pedida).toBe("op1");
    // Fuera del <form> de la oportunidad: sus botones no lo envían.
    expect(cotizacion.closest("form")).toBeNull();
    const historial = screen.getByRole("region", { name: "Historial de cotizaciones" });
    expect(within(historial).getAllByRole("listitem")).toHaveLength(1);
  });

  it("create: no hay sección de Cotización ni se pide ningún historial", async () => {
    let pedidas = 0;
    server.use(
      http.get(quotesUrl, () => {
        pedidas += 1;
        return HttpResponse.json(makeQuoteList([], null));
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/new");

    expect(await screen.findByRole("heading", { name: "Nueva oportunidad" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cotización" })).not.toBeInTheDocument();
    expect(pedidas).toBe(0);
  });

  it("edit: con la oportunidad ganada, la tarjeta de Entrega se monta debajo de Cotización y fuera del <form>", async () => {
    let pedida: string | null = null;
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeOpportunity({ id: params.id as string, status: "WON" })),
      ),
      http.get(deliveriesUrl, ({ request }) => {
        pedida = new URL(request.url).searchParams.get("opportunityId");
        return HttpResponse.json({ data: [makeDelivery({ opportunityId: "op1" })] });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    const entrega = await screen.findByRole("region", { name: "Entrega" });
    expect(within(entrega).getByText("Pendiente de entrega")).toBeInTheDocument();
    expect(pedida).toBe("op1");
    expect(entrega.closest("form")).toBeNull();
    const cotizacion = screen.getByRole("region", { name: "Cotización" });
    // DOCUMENT_POSITION_FOLLOWING: Entrega va después de Cotización.
    expect(
      cotizacion.compareDocumentPosition(entrega) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("edit: con la oportunidad abierta no hay tarjeta de Entrega ni se la pide", async () => {
    let pedidas = 0;
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeOpportunity({ id: params.id as string, status: "OPEN" })),
      ),
      http.get(deliveriesUrl, () => {
        pedidas += 1;
        return HttpResponse.json({ data: [makeDelivery()] });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    expect(await screen.findByRole("region", { name: "Cotización" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Entrega" })).not.toBeInTheDocument();
    expect(pedidas).toBe(0);
  });

  it("edit: la tarjeta de Permuta se monta con la oportunidad ABIERTA, sin unidades, con el aviso y el botón que lleva al alta con el vínculo", async () => {
    let pedida: string | null = null;
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeOpportunity({ id: params.id as string, status: "OPEN" })),
      ),
      http.get(vehiclesUrl, ({ request }) => {
        pedida = new URL(request.url).searchParams.get("tradeInOpportunityId");
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    const permuta = await screen.findByRole("region", { name: "Permuta" });
    expect(
      await within(permuta).findByText("El cliente no entregó ningún auto en esta venta."),
    ).toBeInTheDocument();
    expect(pedida).toBe("op1");
    expect(within(permuta).getByText(/no se descuenta solo del monto/)).toBeInTheDocument();
    expect(within(permuta).getByRole("link", { name: "Agregar auto en permuta" })).toHaveAttribute(
      "href",
      "/vehicles/new?tradeInOpportunityId=op1",
    );
    expect(permuta.closest("form")).toBeNull();
  });

  it("edit: con autos en permuta, la tarjeta los lista con su etiqueta y un link a su ficha de stock", async () => {
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(makeOpportunity({ id: params.id as string, status: "WON" })),
      ),
      http.get(vehiclesUrl, () =>
        HttpResponse.json({
          data: [
            makeVehicleListItem({
              id: "t1",
              make: "Fiat",
              model: "Uno",
              year: 2012,
              internalCode: "STK-000040",
              origin: "TRADE_IN",
              tradeInOpportunityId: "op1",
            }),
            makeVehicleListItem({
              id: "t2",
              make: "VW",
              model: "Gol",
              trim: "Trend",
              year: 2015,
              internalCode: "STK-000041",
              origin: "TRADE_IN",
              tradeInOpportunityId: "op1",
            }),
          ],
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
        }),
      ),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    const permuta = await screen.findByRole("region", { name: "Permuta" });
    const lista = await within(permuta).findByRole("list", { name: "Autos recibidos en permuta" });
    const links = within(lista).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Fiat Uno 2012 · STK-000040",
      "VW Gol Trend 2015 · STK-000041",
    ]);
    expect(links[0]).toHaveAttribute("href", "/vehicles/t1/edit");
    expect(links[1]).toHaveAttribute("href", "/vehicles/t2/edit");
    expect(
      within(permuta).queryByText("El cliente no entregó ningún auto en esta venta."),
    ).not.toBeInTheDocument();
  });

  it("create: no hay tarjeta de Permuta ni se pide ninguna unidad vinculada", async () => {
    let pedidas = 0;
    server.use(
      http.get(vehiclesUrl, ({ request }) => {
        if (new URL(request.url).searchParams.has("tradeInOpportunityId")) pedidas += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/new");

    expect(await screen.findByRole("heading", { name: "Nueva oportunidad" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Permuta" })).not.toBeInTheDocument();
    expect(pedidas).toBe(0);
  });

  it("edit: la tarjeta de Pagos se monta al final, sin gating por estado, y pide los pagos de la oportunidad", async () => {
    let pedida: string | null = null;
    server.use(
      http.get(`${opportunitiesUrl}/:id`, ({ params }) =>
        HttpResponse.json(
          makeOpportunity({ id: params.id as string, status: "LOST", amount: "18500.00" }),
        ),
      ),
      http.get(paymentsUrl, ({ request }) => {
        pedida = new URL(request.url).searchParams.get("opportunityId");
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/op1/edit");

    const pagos = await screen.findByRole("region", { name: "Pagos" });
    expect(await within(pagos).findByText("Todavía no se registraron pagos.")).toBeInTheDocument();
    expect(pedida).toBe("op1");
    // Última tarjeta de la ficha: después de Permuta.
    const permuta = screen.getByRole("region", { name: "Permuta" });
    expect(permuta.compareDocumentPosition(pagos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("create: no hay tarjeta de Pagos ni se piden pagos", async () => {
    let pedidas = 0;
    server.use(
      http.get(paymentsUrl, () => {
        pedidas += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      ...baseHandlers(),
    );
    renderForm("/opportunities/new");

    expect(await screen.findByRole("heading", { name: "Nueva oportunidad" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pagos" })).not.toBeInTheDocument();
    expect(pedidas).toBe(0);
  });
});
