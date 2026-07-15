import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { delay, http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { DashboardPage } from "./DashboardPage";
import type { AuthContextValue } from "../../auth/AuthContext";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const useAuthMock = vi.hoisted(() => vi.fn<() => AuthContextValue>());
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));

function mockAuth(role: "ADMIN" | "USER"): AuthContextValue {
  return {
    status: "authenticated",
    me: { id: "u1", email: "a@x.com", fullName: "Ana", organizationId: "org-1", role },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const opportunitiesUrl = `${env.apiUrl}/opportunities`;
const companiesUrl = `${env.apiUrl}/companies`;
const pipelinesUrl = `${env.apiUrl}/pipelines`;
const stagesUrl = `${env.apiUrl}/stages`;
const usersUrl = `${env.apiUrl}/users`;

// Un único handler para /opportunities: distingue la card de resumen
// (pageSize=1, sin ownerId) de la lista personal reciente (ownerId+pageSize=5)
// por sus propios query params — igual que el backend real los diferenciaría.
function opportunitiesHandler(totalsByStatus: Record<string, number> = { OPEN: 3, WON: 2, LOST: 1 }) {
  return http.get(opportunitiesUrl, ({ request }) => {
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId");
    const status = url.searchParams.get("status") ?? "OPEN";

    if (ownerId) {
      return HttpResponse.json({
        data: [makeOpportunity({ id: "op-recent", title: "Renovación anual", companyId: "co1" })],
        pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      });
    }

    const total = totalsByStatus[status] ?? 0;
    return HttpResponse.json({
      data: [],
      pagination: { page: 1, pageSize: 1, total, totalPages: total },
    });
  });
}

function noDefaultPipelineHandlers() {
  return [
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [makePipeline({ id: "pl1", isDefault: false })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

function defaultPipelineHandlers() {
  return [
    http.get(pipelinesUrl, () =>
      HttpResponse.json({
        data: [makePipeline({ id: "pl1", isDefault: true, name: "Ventas" })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
    http.get(stagesUrl, () =>
      HttpResponse.json({
        data: [makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto", order: 1 })],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    ),
  ];
}

function companyHandler() {
  return http.get(`${companiesUrl}/:id`, ({ params }) =>
    HttpResponse.json(makeCompany({ id: params.id as string, name: "Acme Corp" })),
  );
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("DashboardPage — render general y estados", () => {
  it("renderiza las 4 secciones para ADMIN con datos exactos, sin UUIDs crudos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(opportunitiesHandler(), ...defaultPipelineHandlers(), companyHandler());

    renderDashboard();

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();

    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getByText("3")).toBeInTheDocument());
    expect(within(summary).getByText("2")).toBeInTheDocument();
    expect(within(summary).getByText("1")).toBeInTheDocument();

    const pipeline = screen.getByLabelText("Pipeline");
    await waitFor(() => expect(within(pipeline).getByText(/Prospecto/)).toBeInTheDocument());

    // Ningún id crudo de fixture visible como texto suelto.
    expect(screen.queryByText("op-recent")).not.toBeInTheDocument();
    expect(screen.queryByText("co1")).not.toBeInTheDocument();
    expect(screen.queryByText("st1")).not.toBeInTheDocument();
    expect(screen.queryByText("pl1")).not.toBeInTheDocument();

    expect(screen.getByLabelText("Acciones rápidas")).toBeInTheDocument();
  });

  it("USER no ve Acciones rápidas, pero sí el resto de las secciones", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    server.use(opportunitiesHandler(), ...noDefaultPipelineHandlers());

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(screen.getByLabelText("Resumen comercial")).toBeInTheDocument();
    expect(screen.getByLabelText("Pipeline")).toBeInTheDocument();
    expect(screen.queryByLabelText("Acciones rápidas")).not.toBeInTheDocument();
  });

  it("sin Pipeline default: empty state explícito, no error, y no dispara GET /stages", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let stagesRequests = 0;
    server.use(
      opportunitiesHandler(),
      companyHandler(),
      http.get(pipelinesUrl, () =>
        HttpResponse.json({
          data: [makePipeline({ id: "pl1", isDefault: false })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(stagesUrl, () => {
        stagesRequests += 1;
        return HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } });
      }),
    );

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText("No hay un pipeline configurado como predeterminado.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(stagesRequests).toBe(0);
  });

  it("sin oportunidades abiertas propias: empty state en la lista de recientes", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("ownerId")) {
          return HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 5, total: 0, totalPages: 0 } });
        }
        return HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } });
      }),
      ...noDefaultPipelineHandlers(),
    );

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText("No tenés oportunidades abiertas propias.")).toBeInTheDocument(),
    );
  });

  it("Stage con 0 oportunidades muestra 0, no un error ni un vacío", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      opportunitiesHandler({ OPEN: 0, WON: 0, LOST: 0 }),
      http.get(pipelinesUrl, () =>
        HttpResponse.json({
          data: [makePipeline({ id: "pl1", isDefault: true })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
      http.get(stagesUrl, () =>
        HttpResponse.json({
          data: [makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );

    renderDashboard();

    const pipeline = screen.getByLabelText("Pipeline");
    await waitFor(() => expect(within(pipeline).getByText(/Prospecto/)).toBeInTheDocument());
    expect(within(pipeline).getByText("Prospecto:", { exact: false }).closest("li")?.textContent).toContain(
      "0",
    );
  });

  it("error parcial: si falla la card de WON, las demás secciones y cards siguen mostrando datos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const ownerId = url.searchParams.get("ownerId");
        if (status === "WON") {
          return HttpResponse.json({ error: { message: "caída" } }, { status: 500 });
        }
        if (ownerId) {
          return HttpResponse.json({
            data: [makeOpportunity({ id: "op-recent", title: "Renovación anual", companyId: "co1" })],
            pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
          });
        }
        const total = status === "OPEN" ? 3 : 1;
        return HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 1, total, totalPages: total } });
      }),
      companyHandler(),
      ...noDefaultPipelineHandlers(),
    );

    renderDashboard();

    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getAllByRole("alert").length).toBe(1));
    expect(within(summary).getByText("3")).toBeInTheDocument(); // OPEN sigue OK
    expect(within(summary).getByText("1")).toBeInTheDocument(); // LOST sigue OK

    // La lista de recientes y el pipeline no se ven afectados por el error de WON.
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(
      screen.getByText("No hay un pipeline configurado como predeterminado."),
    ).toBeInTheDocument();
  });

  it("loading independiente: Pipeline puede seguir cargando mientras Resumen y Recientes ya tienen datos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      opportunitiesHandler(),
      companyHandler(),
      http.get(pipelinesUrl, async () => {
        await delay(200);
        return HttpResponse.json({
          data: [makePipeline({ id: "pl1", isDefault: false })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    const pipeline = screen.getByLabelText("Pipeline");
    expect(within(pipeline).getByText("Cargando…")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        within(pipeline).getByText("No hay un pipeline configurado como predeterminado."),
      ).toBeInTheDocument(),
    );
  });

  it("nunca dispara GET /api/users (ADMIN ni USER) — se registra un handler contador, no la ausencia de handler", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let usersRequestCount = 0;
    server.use(
      opportunitiesHandler(),
      ...noDefaultPipelineHandlers(),
      companyHandler(),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(screen.getByLabelText("Pipeline")).toBeInTheDocument();
    expect(usersRequestCount).toBe(0);
  });

  it("ningún request del Dashboard envía organizationId", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const capturedUrls: URL[] = [];
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        capturedUrls.push(new URL(request.url));
        return HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } });
      }),
      http.get(pipelinesUrl, ({ request }) => {
        capturedUrls.push(new URL(request.url));
        return HttpResponse.json({
          data: [makePipeline({ id: "pl1", isDefault: false })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText("No hay un pipeline configurado como predeterminado.")).toBeInTheDocument(),
    );
    expect(capturedUrls.length).toBeGreaterThan(0);
    for (const url of capturedUrls) {
      expect(url.search.toLowerCase()).not.toContain("organizationid");
    }
  });
});
