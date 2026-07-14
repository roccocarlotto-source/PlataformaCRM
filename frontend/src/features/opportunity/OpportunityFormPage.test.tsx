import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { OpportunityFormPage } from "./OpportunityFormPage";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/opportunities`;
const pipelinesUrl = `${env.apiUrl}/pipelines`;
const stagesUrl = `${env.apiUrl}/stages`;
const usersUrl = `${env.apiUrl}/users`;

// PipelineSelect y UserSelect se montan SIEMPRE en este form (sin
// `enabled` gating por texto, a diferencia de CompanySelect/ContactSelect)
// — todo test necesita estos dos handlers como mínimo.
function baseHandlers() {
  return [
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [makePipeline({ id: "pl1", name: "Ventas" }), makePipeline({ id: "pl2", name: "Postventa" })],
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
      http.get(`${env.apiUrl}/companies`, () =>
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
    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");

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
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Debe indicar companyId, contactId, o ambos",
      ),
    );
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
    expect(screen.getByLabelText("Monto")).toHaveValue(1234.5);
    expect(screen.getByLabelText("Moneda")).toHaveValue("ARS");
    expect(screen.getByLabelText("Estado")).toHaveValue("LOST");
    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio");
    expect(screen.getByLabelText("Fecha estimada de cierre")).toHaveValue("2026-08-15");
    expect(screen.getByLabelText("Fecha real de cierre")).toHaveValue("2026-08-20");
    await waitFor(() => expect(screen.getByLabelText("Pipeline")).toHaveValue("pl1"));
    await waitFor(() => expect(screen.getByLabelText("Etapa")).toHaveValue("st1"));
  });

  it("lostReason permanece visible sin importar el status, y no se borra al cambiar de LOST a OPEN", async () => {
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({ status: "LOST", lostReason: "Precio muy alto", pipelineId: "pl1", stageId: "st1" }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderForm("/opportunities/op1/edit");

    await waitFor(() => expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio muy alto"));

    await user.selectOptions(screen.getByLabelText("Estado"), "OPEN");

    expect(screen.getByLabelText("Motivo de pérdida")).toHaveValue("Precio muy alto");
    expect(screen.getByLabelText("Motivo de pérdida")).toBeVisible();
  });

  it("editar sin tocar lostReason y cambiar status reenvía el mismo lostReason (nunca null/undefined por accidente)", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({ id: "op1", status: "LOST", lostReason: "Precio", pipelineId: "pl1", stageId: "st1" }),
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
    await user.selectOptions(screen.getByLabelText("Estado"), "OPEN");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(patchedBody).toBeDefined());
    expect(patchedBody?.lostReason).toBe("Precio");
    expect(patchedBody?.status).toBe("OPEN");
  });

  it("limpiar lostReason explícitamente y guardar envía lostReason: null", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      ...baseHandlers(),
      http.get(`${opportunitiesUrl}/:id`, () =>
        HttpResponse.json(
          makeOpportunity({ id: "op1", lostReason: "Precio", pipelineId: "pl1", stageId: "st1" }),
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
          makeOpportunity({
            id: "op1",
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
      http.get(`${env.apiUrl}/contacts`, ({ request }) => {
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
      http.get(`${env.apiUrl}/companies`, () =>
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
      http.get(`${env.apiUrl}/companies/co1`, () =>
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
        (_, element) => element?.tagName.toLowerCase() === "p" &&
          (element.textContent ?? "").replace(/\s+/g, " ").trim() === "Seleccionado: Ana Pérez",
      );
    }

    // 1) Elegir Company PRIMERO.
    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    // 2) Buscar Contact CON una Company ya elegida — la request a
    // /contacts nunca debe incluir companyId (ContactSelect es
    // deliberadamente independiente, ver ContactSelect.tsx).
    // getByRole("button", ...) en vez de getByText: UserSelect (siempre
    // montado en este form) también puede tener una <option>Ana Pérez
    // </option> con el mismo texto — el resultado de búsqueda de
    // ContactSelect es inequívocamente un <button>, la opción no lo es.
    await user.type(screen.getByPlaceholderText("Buscar contacto por nombre o email…"), "ana");
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
    await user.clear(screen.getByPlaceholderText("Buscar empresa por nombre…"));
    await user.type(screen.getByPlaceholderText("Buscar empresa por nombre…"), "acme");
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    await user.click(screen.getByText("Acme Corp"));

    expect(selectedContactParagraph()).toBeInTheDocument();
  });

  it("amount: hidrata como number editable, envía number en el payload", async () => {
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
});
