import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { delay, http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import { makeCompany } from "../../test/companyFixtures";
import { makeDashboardSummary, makeRevenueSeries } from "../../test/dashboardFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { stubResizeObserver } from "../../test/resizeObserverStub";
import { COUNT_UP_DURATION_MS } from "../../lib/useCountUp";
import { DashboardPage } from "./DashboardPage";
import type { AuthContextValue } from "../../auth/AuthContext";

// jsdom no tiene ResizeObserver y el gráfico de ingresos (§32) no dibuja el
// <svg> hasta medir el ancho de la tarjeta.
stubResizeObserver(600);

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
      email: "a@x.com",
      fullName: "Ana",
      organizationId: "org-1",
      role,
      isPlatformAdmin: false,
    },
    accountUnavailableReason: null,
    profileError: null,
    login: vi.fn(),
    logout: vi.fn(),
    retryProfile: vi.fn(),
  };
}

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;
const revenueSeriesUrl = `${env.apiUrl}/api/opportunities/revenue-series`;
const activitiesUrl = `${env.apiUrl}/api/activities`;
const companiesUrl = `${env.apiUrl}/api/companies`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;
const vehiclesUrl = `${env.apiUrl}/api/vehicles`;

// VehicleSummaryCards (Fase 3b del módulo de vehículos) se monta siempre y
// dispara dos GET /vehicles?pageSize=1 (sin y con status=AVAILABLE) — igual
// que en VehicleListPage.test.tsx, el handler distingue por la query. Va en
// un beforeEach porque ningún test de este archivo trata sobre el stock:
// sin él, onUnhandledRequest:"error" dejaría a las dos cards en error.
function vehiclesSummaryHandler(totals = { inStock: 12, available: 5 }) {
  return http.get(vehiclesUrl, ({ request }) => {
    const url = new URL(request.url);
    const total = url.searchParams.has("status") ? totals.available : totals.inStock;
    return HttpResponse.json({
      data: [],
      pagination: { page: 1, pageSize: 1, total, totalPages: total },
    });
  });
}

function summaryHandler() {
  return http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary()));
}

// El gráfico de ingresos tiene su propio endpoint desde el §33: el resumen ya
// no le alcanza, y en este archivo todos los tests lo montan junto con aquél.
function revenueSeriesHandler() {
  return http.get(revenueSeriesUrl, () => HttpResponse.json(makeRevenueSeries()));
}

// Un único handler para /opportunities: distingue los tres consumidores por
// sus propios query params, igual que el backend real los diferenciaría —
// la tabla de recientes (sortBy=createdAt, sin status), las mayores abiertas
// (status=OPEN + currency) y los conteos por etapa (stageId + pageSize=1).
function opportunitiesHandler(stageTotal = 4) {
  return http.get(opportunitiesUrl, ({ request }) => {
    const url = new URL(request.url);
    if (url.searchParams.has("stageId")) {
      return HttpResponse.json({
        data: [],
        pagination: { page: 1, pageSize: 1, total: stageTotal, totalPages: stageTotal },
      });
    }
    if (url.searchParams.get("status") === "OPEN") {
      return HttpResponse.json({
        data: [makeOpportunity({ id: "op-top", title: "Flota nueva", amount: "8000.00" })],
        pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      });
    }
    return HttpResponse.json({
      data: [makeOpportunity({ id: "op-recent", title: "Renovación anual", companyId: "co1" })],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
    });
  });
}

function activitiesHandler() {
  return http.get(activitiesUrl, () =>
    HttpResponse.json({
      data: [
        makeActivity({
          id: "act-feed",
          subject: "Llamada de seguimiento",
          companyId: "co1",
          authorId: "u2",
        }),
      ],
      pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
    }),
  );
}

function usersHandler(onRequest?: () => void) {
  return http.get(usersUrl, () => {
    onRequest?.();
    return HttpResponse.json({
      data: [makeUser({ id: "u2", fullName: "Bruno Díaz" })],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
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

function follows(before: HTMLElement, after: HTMLElement) {
  return Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const SECTIONS = [
  "Resumen de stock",
  "Resumen comercial",
  "Ingresos ganados por mes",
  "Oportunidades recientes",
  "Mayores oportunidades abiertas",
  "Pipeline",
  "Actividad reciente",
  "Acciones rápidas",
];

describe("DashboardPage — render general y estados", () => {
  beforeEach(() => {
    server.use(vehiclesSummaryHandler());
  });

  it("ADMIN: las 8 secciones en el orden del §30, con datos exactos y sin UUIDs crudos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      summaryHandler(),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      ...defaultPipelineHandlers(),
      companyHandler(),
    );

    renderDashboard();

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();

    const regions = SECTIONS.map((name) => screen.getByLabelText(name));
    for (let index = 1; index < regions.length; index += 1) {
      expect(follows(regions[index - 1], regions[index])).toBe(true);
    }

    // Stock (Fase 3b) y KPI comerciales (§30) con sus números.
    const stock = screen.getByLabelText("Resumen de stock");
    await waitFor(() => expect(within(stock).getByText("12")).toBeInTheDocument());
    expect(within(stock).getByText("5")).toBeInTheDocument();

    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getByText("3000.00 USD")).toBeInTheDocument());
    expect(within(summary).getByText("5")).toBeInTheDocument();
    expect(within(summary).getByText("50%")).toBeInTheDocument();

    // Gráfico, recientes, mayores, pipeline y feed.
    await within(screen.getByLabelText("Ingresos ganados por mes")).findByRole("img");
    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    expect(await screen.findByText("Acme Corp", { selector: "td" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Flota nueva")).toBeInTheDocument());
    const pipeline = screen.getByLabelText("Pipeline");
    await waitFor(() => expect(within(pipeline).getByText(/Prospecto/)).toBeInTheDocument());
    const feed = screen.getByLabelText("Actividad reciente");
    await waitFor(() =>
      expect(within(feed).getByText("Llamada de seguimiento")).toBeInTheDocument(),
    );
    await waitFor(() => expect(feed).toHaveTextContent("por Bruno Díaz"));

    // Ningún id crudo de fixture visible como texto suelto.
    for (const raw of ["op-recent", "op-top", "act-feed", "co1", "st1", "pl1", "u2"]) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
    }

    expect(screen.getByLabelText("Acciones rápidas")).toBeInTheDocument();
  });

  it("USER: no ve Acciones rápidas, sí el resto, y nunca dispara GET /api/users", async () => {
    useAuthMock.mockReturnValue(mockAuth("USER"));
    let usersRequestCount = 0;
    server.use(
      summaryHandler(),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      companyHandler(),
      usersHandler(() => {
        usersRequestCount += 1;
      }),
      ...noDefaultPipelineHandlers(),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Llamada de seguimiento")).toBeInTheDocument());
    for (const name of SECTIONS.filter((section) => section !== "Acciones rápidas")) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Acciones rápidas")).not.toBeInTheDocument();
    expect(usersRequestCount).toBe(0);
  });

  it("sin Pipeline default: empty state explícito, no error, y no dispara GET /stages", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    let stagesRequests = 0;
    server.use(
      summaryHandler(),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      companyHandler(),
      ...noDefaultPipelineHandlers(),
      http.get(stagesUrl, () => {
        stagesRequests += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );

    renderDashboard();

    await waitFor(() =>
      expect(
        screen.getByText("No hay un pipeline configurado como predeterminado."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(stagesRequests).toBe(0);
  });

  it("error parcial: si falla el resumen, caen KPI y mayores abiertas — el gráfico, con su propio endpoint (§33), sigue", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      companyHandler(),
      ...defaultPipelineHandlers(),
    );

    renderDashboard();

    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getAllByRole("alert")).toHaveLength(3));
    await waitFor(() =>
      expect(
        within(screen.getByLabelText("Mayores oportunidades abiertas")).getByRole("alert"),
      ).toBeInTheDocument(),
    );
    // Desde el §33 el gráfico ya no lee el resumen: que el resumen caiga no lo
    // afecta. Es la degradación por sección llevada un paso más lejos.
    const grafico = screen.getByLabelText("Ingresos ganados por mes");
    await within(grafico).findByRole("img");
    expect(within(grafico).queryByRole("alert")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Renovación anual")).toBeInTheDocument());
    const pipeline = screen.getByLabelText("Pipeline");
    await waitFor(() => expect(within(pipeline).getByText(/Prospecto/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Llamada de seguimiento")).toBeInTheDocument());
  });

  // §35: el selector dejó de ser un control de la tarjeta del gráfico y pasó a
  // ser uno de la página. Un click tiene que mover la fila de KPIs Y el
  // gráfico, con un request de cada endpoint por granularidad.
  it("el selector vive en el header de la página, junto al <h1>, y no en la tarjeta del gráfico", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      summaryHandler(),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      companyHandler(),
      ...defaultPipelineHandlers(),
    );

    renderDashboard();

    const toggle = screen.getByRole("group", { name: "Período" });
    const titulo = screen.getByRole("heading", { name: "Dashboard" });
    expect(toggle.parentElement).toHaveClass("ds-page-header");
    expect(toggle.parentElement).toContainElement(titulo);
    expect(within(toggle).getByRole("button", { name: "Mensual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const grafico = await screen.findByLabelText("Ingresos ganados por mes");
    await within(grafico).findByRole("img");
    expect(within(grafico).queryByRole("group", { name: "Período" })).not.toBeInTheDocument();
  });

  it("elegir Semanal mueve las 3 KPI que siguen al período Y el gráfico, con un request por endpoint", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const user = userEvent.setup();
    const resumenes: string[] = [];
    const granularidades: string[] = [];
    server.use(
      http.get(summaryUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity") ?? "";
        resumenes.push(granularity);
        return HttpResponse.json(
          granularity === "week"
            ? makeDashboardSummary({
                granularity: "week",
                createdThisPeriod: { count: 1, value: "100.00" },
                createdLastPeriod: { count: 1, value: "100.00" },
                wonThisPeriod: { count: 1, value: "700.00" },
                wonLastPeriod: { count: 1, value: "700.00" },
              })
            : makeDashboardSummary(),
        );
      }),
      http.get(revenueSeriesUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity") ?? "";
        granularidades.push(granularity);
        return HttpResponse.json(makeRevenueSeries({ granularity: granularity as "month" }));
      }),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      companyHandler(),
      ...defaultPipelineHandlers(),
    );

    renderDashboard();

    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getByText("3000.00 USD")).toBeInTheDocument());
    expect(within(summary).getByText("Ganado este mes")).toBeInTheDocument();
    await within(screen.getByLabelText("Ingresos ganados por mes")).findByRole("img");

    await user.click(screen.getByRole("button", { name: "Semanal" }));

    // Las tres cards que siguen al selector cambian de rótulo y de número…
    await waitFor(() => expect(within(summary).getByText("700.00 USD")).toBeInTheDocument());
    expect(within(summary).getByText("Ganado esta semana")).toBeInTheDocument();
    expect(within(summary).getByText("Oportunidades creadas esta semana")).toBeInTheDocument();
    expect(within(summary).getByText("Tasa de cierre de la semana")).toBeInTheDocument();
    // …y el gráfico también.
    await screen.findByLabelText("Ingresos ganados por semana");

    // El stock no se movió: ni siquiera mira el resumen.
    const stock = screen.getByLabelText("Resumen de stock");
    expect(within(stock).getByText("12")).toBeInTheDocument();
    expect(within(stock).getByText("5")).toBeInTheDocument();

    // Un request por endpoint y por granularidad: las KPI y TopDealsList
    // comparten la misma entrada de caché, no piden el resumen dos veces.
    expect(resumenes).toEqual(["month", "week"]);
    expect(granularidades).toEqual(["month", "week"]);
  });

  it("loading independiente: Pipeline puede seguir cargando mientras el resto ya tiene datos", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    server.use(
      summaryHandler(),
      revenueSeriesHandler(),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
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
    const summary = screen.getByLabelText("Resumen comercial");
    await waitFor(() => expect(within(summary).getByText("3000.00 USD")).toBeInTheDocument());
    const pipeline = screen.getByLabelText("Pipeline");
    expect(within(pipeline).getByText("Cargando…")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        within(pipeline).getByText("No hay un pipeline configurado como predeterminado."),
      ).toBeInTheDocument(),
    );
  });

  it("ningún request del Dashboard envía organizationId", async () => {
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const capturedUrls: URL[] = [];
    const capture = (request: Request) => capturedUrls.push(new URL(request.url));
    server.use(
      http.get(summaryUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json(makeDashboardSummary());
      }),
      http.get(revenueSeriesUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json(makeRevenueSeries());
      }),
      http.get(opportunitiesUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 5, total: 0, totalPages: 0 },
        });
      }),
      http.get(activitiesUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 8, total: 0, totalPages: 0 },
        });
      }),
      http.get(usersUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      http.get(pipelinesUrl, ({ request }) => {
        capture(request);
        return HttpResponse.json({
          data: [makePipeline({ id: "pl1", isDefault: false })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      }),
    );

    renderDashboard();

    await waitFor(() =>
      expect(
        screen.getByText("No hay un pipeline configurado como predeterminado."),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText("Todavía no hay actividades.")).toBeInTheDocument(),
    );
    expect(capturedUrls.length).toBeGreaterThan(0);
    for (const url of capturedUrls) {
      expect(url.search.toLowerCase()).not.toContain("organizationid");
    }
  });
});

// ---------------------------------------------------------------------------
// §37: los números grandes de las dos filas de arriba cuentan desde 0 al
// entrar, y elegir otro período después los actualiza directo. El resto del
// archivo corre con el matchMedia global de test/setup.ts (reduced motion);
// acá se pisa, y requestAnimationFrame va con timers falsos (MSW, waitFor y
// userEvent siguen con timers reales).
// ---------------------------------------------------------------------------

describe("DashboardPage — conteo de llegada (§37)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stock y KPI comerciales cuentan en la primera carga; Semanal después no vuelve a contar", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    useAuthMock.mockReturnValue(mockAuth("ADMIN"));
    const user = userEvent.setup();
    server.use(
      vehiclesSummaryHandler(),
      http.get(summaryUrl, ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("granularity") === "week"
            ? makeDashboardSummary({
                granularity: "week",
                createdThisPeriod: { count: 1, value: "100.00" },
                wonThisPeriod: { count: 1, value: "700.00" },
                lostCountThisPeriod: 3,
              })
            : makeDashboardSummary(),
        ),
      ),
      http.get(revenueSeriesUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity") as "month";
        return HttpResponse.json(makeRevenueSeries({ granularity }));
      }),
      opportunitiesHandler(),
      activitiesHandler(),
      usersHandler(),
      companyHandler(),
      ...defaultPipelineHandlers(),
    );

    renderDashboard();

    const valuesOf = (region: string) =>
      Array.from(screen.getByLabelText(region).querySelectorAll(".ds-kpi-value")).map(
        (dd) => dd.textContent,
      );

    await waitFor(() => expect(valuesOf("Resumen de stock")).toEqual(["0", "0"]));
    await waitFor(() => expect(valuesOf("Resumen comercial")).toEqual(["0", "0.00 USD", "0%"]));

    act(() => {
      vi.advanceTimersByTime(COUNT_UP_DURATION_MS + 50);
    });
    expect(valuesOf("Resumen de stock")).toEqual(["12", "5"]);
    expect(valuesOf("Resumen comercial")).toEqual(["5", "3000.00 USD", "50%"]);

    await user.click(screen.getByRole("button", { name: "Semanal" }));
    // Sin avanzar ningún frame: si volviera a contar, se quedaría en 0.
    await waitFor(() => expect(valuesOf("Resumen comercial")).toEqual(["1", "700.00 USD", "25%"]));
    expect(valuesOf("Resumen de stock")).toEqual(["12", "5"]);
  });
});
