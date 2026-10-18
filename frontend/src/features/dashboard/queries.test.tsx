import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary, makeRevenueSeries } from "../../test/dashboardFixtures";
import { makeOpportunityListItem } from "../../test/opportunityFixtures";
import { useDashboardSummary, useDefaultPipelineStageSummary, useRevenueSeries } from "./queries";
import type { OpportunityListResponse } from "../opportunity/types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;
const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;
const revenueSeriesUrl = `${env.apiUrl}/api/opportunities/revenue-series`;
const stageCountsUrl = `${env.apiUrl}/api/opportunities/stage-counts`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function opportunityListResponse(
  overrides: Partial<OpportunityListResponse> = {},
): OpportunityListResponse {
  return {
    data: [makeOpportunityListItem()],
    pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    ...overrides,
  };
}

describe("useDashboardSummary", () => {
  it("pide GET /opportunities/dashboard-summary con la granularidad en el query param y devuelve el resumen tal cual", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(summaryUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(makeDashboardSummary({ openCount: 7 }));
      }),
    );

    const { result } = renderHook(() => useDashboardSummary("month"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.searchParams.get("granularity")).toBe("month");
    expect(result.current.data?.openCount).toBe(7);
    expect(result.current.data?.granularity).toBe("month");
  });

  // §35: el resumen dejó de tener una key única. Cada granularidad es su
  // propia entrada de caché, igual que la serie del gráfico: volver a una ya
  // vista no pide nada, y pedir otra no invalida la anterior.
  it("una key por granularidad: cada período se pide una sola vez y queda cacheado aparte", async () => {
    const pedidas: string[] = [];
    server.use(
      http.get(summaryUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity") ?? "";
        pedidas.push(granularity);
        return HttpResponse.json(
          makeDashboardSummary({ granularity: granularity as "month" | "week" | "day" }),
        );
      }),
    );

    const queryClient = newClient();
    const { result, rerender } = renderHook(
      ({ granularity }: { granularity: "month" | "week" }) => useDashboardSummary(granularity),
      {
        wrapper: wrapperFor(queryClient),
        initialProps: { granularity: "month" } as { granularity: "month" | "week" },
      },
    );

    await waitFor(() => expect(result.current.data?.granularity).toBe("month"));

    rerender({ granularity: "week" });
    await waitFor(() => expect(result.current.data?.granularity).toBe("week"));

    expect(pedidas).toEqual(["month", "week"]);
    expect(queryClient.getQueryData(["dashboard", "summary", "month"])).toBeDefined();
    expect(queryClient.getQueryData(["dashboard", "summary", "week"])).toBeDefined();

    // Volver a la mensual muestra los datos cacheados en el mismo render, sin
    // pasar por loading: lo que se vuelva a pedir de fondo (acá sí, porque
    // este QueryClient de test no tiene staleTime) no deja la card en blanco.
    rerender({ granularity: "month" });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.granularity).toBe("month");
  });

  // §33 + §35: los dos agregados siguen siendo endpoints separados, con keys
  // separadas. Se piden con la misma granularidad, pero cada uno se refetchea
  // por su cuenta.
  it("useRevenueSeries: key propia, distinta de la del resumen, también por granularidad", async () => {
    const granularidades: string[] = [];
    let summaryRequests = 0;
    server.use(
      http.get(summaryUrl, () => {
        summaryRequests += 1;
        return HttpResponse.json(makeDashboardSummary());
      }),
      http.get(revenueSeriesUrl, ({ request }) => {
        const granularity = new URL(request.url).searchParams.get("granularity") ?? "";
        granularidades.push(granularity);
        return HttpResponse.json(
          makeRevenueSeries({ granularity: granularity as "month" | "week" | "day" }),
        );
      }),
    );

    const queryClient = newClient();
    const { result, rerender } = renderHook(
      ({ granularity }: { granularity: "month" | "week" }) => ({
        summary: useDashboardSummary("month"),
        series: useRevenueSeries(granularity),
      }),
      {
        wrapper: wrapperFor(queryClient),
        initialProps: { granularity: "month" } as { granularity: "month" | "week" },
      },
    );

    await waitFor(() => expect(result.current.series.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.summary.isSuccess).toBe(true));

    rerender({ granularity: "week" });
    await waitFor(() => expect(result.current.series.data?.granularity).toBe("week"));

    expect(granularidades).toEqual(["month", "week"]);
    // El resumen mensual sigue montado y no se volvió a pedir: son dos
    // entradas de caché independientes.
    expect(summaryRequests).toBe(1);
    expect(queryClient.getQueryData(["dashboard", "revenue-series", "month"])).toBeDefined();
    expect(queryClient.getQueryData(["dashboard", "revenue-series", "week"])).toBeDefined();
  });

  it("error: se refleja como isError, sin datos inventados", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useDashboardSummary("month"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("dos consumidores con la MISMA granularidad comparten un único request", async () => {
    let requests = 0;
    server.use(
      http.get(summaryUrl, () => {
        requests += 1;
        return HttpResponse.json(makeDashboardSummary());
      }),
    );

    const wrapper = wrapperFor(newClient());
    const first = renderHook(() => useDashboardSummary("week"), { wrapper });
    const second = renderHook(() => useDashboardSummary("week"), { wrapper });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(requests).toBe(1);
  });

  it("no dispara ningún request a GET /api/users ni al listado de oportunidades", async () => {
    let otherRequests = 0;
    server.use(
      http.get(summaryUrl, () => HttpResponse.json(makeDashboardSummary())),
      http.get(usersUrl, () => {
        otherRequests += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
      http.get(opportunitiesUrl, () => {
        otherRequests += 1;
        return HttpResponse.json(opportunityListResponse());
      }),
    );

    const { result } = renderHook(() => useDashboardSummary("month"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(otherRequests).toBe(0);
  });
});

describe("useDefaultPipelineStageSummary", () => {
  // Desde el ensayo del 2026-10-17 es UN pedido: GET /opportunities/stage-counts
  // (el proceso por defecto, sus etapas en orden y el conteo de cada una). Los
  // de antes —procesos, etapas y un listado por etapa— no se piden más.
  function contarPedidosViejos() {
    const pedidos = { procesos: 0, etapas: 0, listados: 0 };
    server.use(
      http.get(pipelinesUrl, () => {
        pedidos.procesos += 1;
        return HttpResponse.json({});
      }),
      http.get(stagesUrl, () => {
        pedidos.etapas += 1;
        return HttpResponse.json({});
      }),
      http.get(opportunitiesUrl, () => {
        pedidos.listados += 1;
        return HttpResponse.json(opportunityListResponse());
      }),
    );
    return pedidos;
  }

  it("un solo GET /opportunities/stage-counts: las etapas en el orden que vienen, con su total", async () => {
    const pedidos = contarPedidosViejos();
    let pedidosDeConteos = 0;
    server.use(
      http.get(stageCountsUrl, () => {
        pedidosDeConteos += 1;
        return HttpResponse.json({
          pipeline: { id: "pl1", name: "Ventas" },
          stages: [
            { id: "st1", name: "Prospecto", order: 1, total: 3 },
            { id: "st2", name: "Propuesta", order: 2, total: 0 },
          ],
        });
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.hasDefaultPipeline).toBe(true));
    expect(result.current.stages).toEqual([
      { stageId: "st1", name: "Prospecto", order: 1, total: 3, isLoading: false, isError: false },
      { stageId: "st2", name: "Propuesta", order: 2, total: 0, isLoading: false, isError: false },
    ]);
    expect(result.current.isLoadingStages).toBe(false);
    expect(result.current.isErrorStages).toBe(false);
    expect(pedidosDeConteos).toBe(1);
    expect(pedidos).toEqual({ procesos: 0, etapas: 0, listados: 0 });
  });

  it("sin proceso por defecto: hasDefaultPipeline=false, sin etapas y sin error", async () => {
    server.use(http.get(stageCountsUrl, () => HttpResponse.json({ pipeline: null, stages: [] })));

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isLoadingPipelines).toBe(false));
    expect(result.current.hasDefaultPipeline).toBe(false);
    expect(result.current.isErrorPipelines).toBe(false);
    expect(result.current.stages).toEqual([]);
  });

  it("si el pedido falla: isErrorPipelines con el mensaje y sin conteos inventados", async () => {
    server.use(
      http.get(stageCountsUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isErrorPipelines).toBe(true));
    expect(result.current.errorPipelines?.message).toBe("caída");
    expect(result.current.hasDefaultPipeline).toBe(false);
    expect(result.current.stages).toEqual([]);
  });
});
