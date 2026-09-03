import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeContact } from "../../test/contactFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { OpportunityListPage } from "./OpportunityListPage";
import type { AuthContextValue } from "../../auth/AuthContext";
import type { OpportunityListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: "u1", email: "a@x.com", fullName: "A", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const contactsUrl = `${env.apiUrl}/api/contacts`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;

// OpportunityListPage siempre monta PipelineSelect como filtro (sin
// `enabled` gating — a diferencia de CompanySelect/ContactSelect, no busca
// por texto, así que dispara GET /pipelines de entrada). Todos los tests de
// esta página necesitan un handler para el listado, no solo para el
// detail-by-id que usa la resolución de relaciones.
function relationHandlers() {
  return [
    http.get(`${companiesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
    ),
    http.get(`${contactsUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeContact({ id: params.id as string, firstName: "Ana", lastName: "Pérez" }),
      ),
    ),
    http.get(`${pipelinesUrl}/:id`, ({ params }) =>
      HttpResponse.json(makePipeline({ id: params.id as string, name: "Ventas" })),
    ),
    http.get(`${stagesUrl}/:id`, ({ params }) =>
      HttpResponse.json(
        makeStage({ id: params.id as string, pipelineId: "pl1", name: "Prospecto" }),
      ),
    ),
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [makePipeline({ id: "pl1", name: "Ventas" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

// Solo para tests con rol ADMIN: useOwnerNames(true) dispara GET /api/users
// incondicionalmente (ver relationResolution.ts). Los tests con rol USER
// deliberadamente NO incluyen este handler (ver más abajo).
function usersHandler() {
  return http.get(usersUrl, () =>
    HttpResponse.json({
      data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OpportunityListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("OpportunityListPage", () => {
  it("loading, éxito, error y empty state", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const listResponse: OpportunityListResponse = {
      data: [makeOpportunity()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      http.get(opportunitiesUrl, () => HttpResponse.json(listResponse)),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    // "Cargando…" aparece tanto en el propio listado como en PipelineSelect
    // (filtro, con su propia carga independiente) — se verifica que exista
    // al menos una instancia, no una única global.
    expect(screen.getAllByText("Cargando…").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
  });

  it("error de listado se muestra como estado de error real", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({ error: { message: "boom" } }, { status: 500 }),
      ),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("empty state cuando data está vacía", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No hay oportunidades para mostrar.")).toBeInTheDocument(),
    );
  });

  it("filtros reales (search/status/pipeline) producen la query esperada, y paginación avanza", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const captured: URL[] = [];
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json({
          data: [makeOpportunity()],
          pagination: { page: 1, pageSize: 20, total: 100, totalPages: 5 },
        });
      }),
      usersHandler(),
      ...relationHandlers(),
    );
    const user = userEvent.setup();

    renderPage();
    await waitFor(() => expect(captured.length).toBeGreaterThan(0));

    await user.type(screen.getByPlaceholderText("Buscar por título"), "renovación");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("search")).toBe("renovación"));

    await user.selectOptions(screen.getByLabelText("Estado"), "WON");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("status")).toBe("WON"));

    await waitFor(() => expect(screen.getByLabelText("Filtrar por pipeline")).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Filtrar por pipeline"), "pl1");
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("pipelineId")).toBe("pl1"));

    await user.click(screen.getByText("Siguiente"));
    await waitFor(() => expect(captured.at(-1)?.searchParams.get("page")).toBe("2"));
  });

  it("resuelve Company/Contact/Pipeline/Stage a nombre humano, nunca UUID crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [
            makeOpportunity({
              companyId: "co1",
              contactId: "ct1",
              pipelineId: "pl1",
              stageId: "st1",
            }),
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const row = screen.getByText("Renovación anual").closest("tr") as HTMLElement;
    // "Ana Pérez" aparece dos veces en la fila a propósito: es tanto el
    // Contact vinculado como el Owner resuelto (mismo fixture de usuario) —
    // ambas columnas resuelven independientemente al mismo nombre humano.
    expect(within(row).getAllByText("Ana Pérez")).toHaveLength(2);
    // Pipeline y Stage van consolidados en un solo badge "Embudo · Etapa".
    expect(within(row).getByText("Ventas · Prospecto")).toBeInTheDocument();
    expect(within(row).queryByText("co1")).not.toBeInTheDocument();
    expect(within(row).queryByText("ct1")).not.toBeInTheDocument();
  });

  it("fallback '—' cuando una relación falla al resolver (ej. Company borrada)", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ companyId: "co-borrada", contactId: null })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(`${companiesUrl}/co-borrada`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    const row = screen.getByText("Renovación anual").closest("tr");
    expect(row).toHaveTextContent("—");
    expect(row).not.toHaveTextContent("co-borrada");
  });

  it("ADMIN ve la columna Propietario resuelta a fullName", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      usersHandler(),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Propietario")).toBeInTheDocument());
    await waitFor(() => {
      const row = screen.getByText("Renovación anual").closest("tr");
      expect(row).toHaveTextContent("Ana Pérez");
    });
  });

  it("USER: montar la página NO dispara ningún request a /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    // Contador explícito, no solo "ausencia de handler": una request no
    // manejada bajo onUnhandledRequest:"error" (test/setup.ts) hace que la
    // query interna entre en estado de error silenciosamente — no lanza una
    // excepción que falle el test por sí sola si nada la asertea. La única
    // forma confiable de probar "cero requests" es contarlas de verdad.
    let usersRequestCount = 0;
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [makeUser({ id: "u1" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    // Margen para que un fetch indebido, si lo hubiera, alcance a dispararse.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(usersRequestCount).toBe(0);
  });

  it("USER: no ve la columna Propietario ni el ownerId crudo", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity({ ownerId: "u1" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(screen.queryByText("Propietario")).not.toBeInTheDocument();
    expect(screen.queryByText("u1")).not.toBeInTheDocument();
  });

  it("USER: la ausencia de acceso al catálogo de Users no rompe el resto de la página", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [
            makeOpportunity({ companyId: "co1", pipelineId: "pl1", stageId: "st1", ownerId: "u1" }),
          ],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    const row = screen.getByText("Renovación anual").closest("tr") as HTMLElement;
    // Pipeline y Stage van consolidados en un solo badge "Embudo · Etapa".
    expect(within(row).getByText("Ventas · Prospecto")).toBeInTheDocument();
    expect(within(row).getByText(/1500\.00 USD/)).toBeInTheDocument();
  });

  it("acciones de escritura (Nueva/Editar/Eliminar) visibles solo para ADMIN", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({
          data: [makeOpportunity()],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
      ...relationHandlers(),
    );

    renderPage();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(screen.queryByText("Nueva oportunidad")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Eliminar")).not.toBeInTheDocument();
  });
});
