import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import type { AuthContextValue } from "../../auth/AuthContext";
import { makeOpportunity } from "../../test/opportunityFixtures";
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

// PipelineSelect y UserSelect se montan SIEMPRE en este form (sin
// `enabled` gating por texto, a diferencia de CompanySelect/ContactSelect)
// — todo test necesita estos dos handlers como mínimo.
function baseHandlers() {
  return [
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
      const stages =
        pipelineId === "pl1"
          ? [makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto" })]
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

    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");

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

    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toHaveValue("pl2"));
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("st2"));

    await user.type(screen.getByLabelText("Título"), "Desde el embudo");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(screen.getByText("lista de oportunidades")).toBeInTheDocument());
    expect(postedBody).toMatchObject({ pipelineId: "pl2", stageId: "st2" });
  });

  // Ítem 7 de docs/frontend-cambios-pendientes.md: mismo contrato que
  // Company y Contact — el usuario actual ya está marcado, la antigua opción
  // "Asignado a quien crea (por defecto)" no existe más, y el id viaja
  // explícito en el POST (resolveOwnerId haría lo mismo si no se mandara).
  it("create: Propietario arranca preseleccionado en quien crea, sin opción 'por defecto', y viaja en el POST", async () => {
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

    await waitFor(() => expect(screen.getByLabelText("Propietario")).toHaveValue("u1"));
    const select = screen.getByLabelText("Propietario");
    expect(select).not.toHaveTextContent("Asignado a quien crea (por defecto)");
    expect(select).not.toHaveTextContent("Sin asignar");
    expect(select.querySelector('option[value=""]')).toBeNull();

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
    await waitFor(() => expect(screen.getByText("Ventas")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
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
    const pipeline = await screen.findByLabelText("Pipeline");
    expect(pipeline).toBeRequired();
    expect(screen.getByText("Pipeline")).toHaveClass("ds-required");
    expect(screen.getByLabelText("Etapa")).toBeRequired();
    expect(screen.getByText("Etapa")).toHaveClass("ds-required");
    expect(screen.getAllByText("Los campos con asterisco (*) son obligatorios.")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /guardar/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(posted).toBe(false);

    const form = pipeline.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Elegí un pipeline antes de guardar."),
    );

    await user.selectOptions(pipeline, "pl1");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Elegí una etapa antes de guardar."),
    );
    expect(posted).toBe(false);
    expect(screen.queryByText("lista de oportunidades")).not.toBeInTheDocument();
  });

  it("edit: hidrata todos los campos correctamente (amount, fechas slice(0,10), lostReason, relaciones)", async () => {
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
    expect(
      within(screen.getByLabelText("Moneda"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["ARS", "USD", "UYU"]);
    expect(screen.getByLabelText("Estado")).toHaveValue("LOST");
    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio");
    expect(screen.getByLabelText("Fecha estimada de cierre")).toHaveValue("2026-08-15");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toHaveValue("pl1"));
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("st1"));
  });

  // -------------------------------------------------------------------------
  // Estado y cierre (ítems 18.E y 18.F de docs/frontend-cambios-pendientes.md).
  // Reemplaza a propósito la decisión de M5 ("lostReason siempre visible,
  // status nunca lo toca"): Motivo de pérdida y Fecha real de cierre solo se
  // ven con Ganada/Perdida, cerrar desde Abierta completa la fecha con hoy
  // si estaba vacía, y reabrir limpia los dos.
  // -------------------------------------------------------------------------

  it("edit: el select de Estado muestra Abierta/Ganada/Perdida con los values del enum", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(makeOpportunity({ pipelineId: "pl1", stageId: "st1" })),
      ),
    );
    renderForm("/opportunities/op1/edit");

    const estado = await screen.findByLabelText("Estado");
    const options = within(estado).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Abierta", "Ganada", "Perdida"]);
    expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
      "OPEN",
      "WON",
      "LOST",
    ]);
    expect(within(estado).queryByRole("option", { name: "OPEN" })).not.toBeInTheDocument();
  });

  it("edit: con Estado Abierta no se ven Motivo de pérdida ni Fecha real de cierre; con Ganada o Perdida sí, los dos", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(makeOpportunity({ status: "OPEN", pipelineId: "pl1", stageId: "st1" })),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue("OPEN"));
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha real de cierre")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Estado"), "WON");
    expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
    expect(screen.getByLabelText("Fecha real de cierre")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Estado"), "LOST");
    expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
    expect(screen.getByLabelText("Fecha real de cierre")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Estado"), "OPEN");
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha real de cierre")).not.toBeInTheDocument();
  });

  it.each([
    ["LOST", "Perdida"],
    ["WON", "Ganada"],
  ])(
    "edit: pasar de Abierta a %s con Fecha real vacía la completa con hoy, y sigue editable",
    async (status, label) => {
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

      await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue("OPEN"));
      await user.selectOptions(screen.getByLabelText("Estado"), label);

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

  it("edit: si Fecha real ya tenía valor, cambiar el Estado no lo pisa (ni Abierta → Perdida, ni Perdida → Ganada)", async () => {
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

    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue("OPEN"));
    await user.selectOptions(screen.getByLabelText("Estado"), "LOST");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");

    await user.selectOptions(screen.getByLabelText("Estado"), "WON");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");
  });

  it("edit: una oportunidad que ya cargó cerrada con fecha vacía no se autocompleta al cambiar entre Ganada y Perdida (solo la transición desde Abierta)", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({
            status: "LOST",
            actualCloseDate: null,
            pipelineId: "pl1",
            stageId: "st1",
          }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue("LOST"));
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Estado"), "WON");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("");
  });

  it("edit: reabrir (Perdida → Abierta) limpia Motivo y Fecha real, y el PATCH los manda como null", async () => {
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

    await waitFor(() =>
      expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio muy alto"),
    );
    await user.selectOptions(screen.getByLabelText("Estado"), "OPEN");
    expect(screen.queryByLabelText("Motivo de pérdida")).not.toBeInTheDocument();

    // Volver a cerrar arranca limpio: sin el motivo viejo, con la fecha de
    // hoy (la transición desde Abierta se vuelve a vivir).
    await user.selectOptions(screen.getByLabelText("Estado"), "LOST");
    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue(todayIsoDate());

    await user.selectOptions(screen.getByLabelText("Estado"), "OPEN");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toMatchObject({ status: "OPEN", lostReason: null, actualCloseDate: null });
  });

  it("editar sin tocar lostReason y cambiar de Perdida a Ganada reenvía el mismo lostReason (nunca null/undefined por accidente)", async () => {
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
    await user.selectOptions(screen.getByLabelText("Estado"), "WON");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody).toMatchObject({
      status: "WON",
      lostReason: "Precio",
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
    await user.type(screen.getByLabelText("Fecha estimada de cierre"), "2026-08-15");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(postedBody).toBeDefined());
    expect(postedBody?.expectedCloseDate).toBe("2026-08-15");
  });

  it("cambiar Pipeline limpia Stage (StageSelect vuelve a quedar sin selección)", async () => {
    server.use(...baseHandlers());
    const user = userEvent.setup();
    renderForm("/opportunities/new");

    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
    expect(screen.getByLabelText("Etapa")).toHaveValue("st1");

    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl2");

    await waitFor(() => expect(screen.getByText("Cierre")).toBeInTheDocument());
    expect(screen.getByLabelText("Etapa")).toHaveValue("");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
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

    const moneda = screen.getByLabelText("Moneda");
    expect(moneda.tagName).toBe("SELECT");
    expect(moneda).toHaveValue("USD");
    expect(
      within(moneda)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["USD", "UYU"]);

    await user.type(screen.getByLabelText("Título"), "En pesos");
    await user.selectOptions(moneda, "UYU");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");

    await user.type(screen.getByPlaceholderText(VEHICLE_PLACEHOLDER), "corolla");
    await user.click(
      await screen.findByRole("button", { name: "Toyota Corolla 2020 · 25000.00 USD" }),
    );

    expect(screen.getByLabelText("Monto")).toHaveValue("");
    // Ítem 18.B: mientras Moneda está vacía por el vínculo, el <select>
    // cerrado muestra la opción "Según la unidad" (value "") para no
    // mentir con "USD".
    expect(screen.getByLabelText("Moneda")).toHaveValue("");
    expect(
      within(screen.getByLabelText("Moneda")).getByRole("option", { name: "Según la unidad" }),
    ).toBeInTheDocument();
    expect(screen.getByText(PRICE_HINT)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Financiación"), "INSTALLMENT_24M");
    await user.selectOptions(screen.getByLabelText("Origen del cliente"), "WHATSAPP");
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
    await user.selectOptions(screen.getByLabelText("Pipeline"), "pl1");
    await waitFor(() => expect(screen.getByText("Prospecto")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Etapa"), "st1");
    await user.type(screen.getByPlaceholderText(VEHICLE_PLACEHOLDER), "corolla");
    await user.click(
      await screen.findByRole("button", { name: "Toyota Corolla 2020 · 25000.00 USD" }),
    );
    expect(screen.getByText(PRICE_HINT)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Monto"), "23500");
    expect(screen.queryByText(PRICE_HINT)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Moneda"), "UYU");
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
    expect(screen.getByLabelText("Financiación")).toHaveValue("OWN_FINANCING");
    expect(screen.getByLabelText("Origen del cliente")).toHaveValue("SHOWROOM");

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
});
