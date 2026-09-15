import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeDashboardSummary } from "../../test/dashboardFixtures";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { useDashboardSummary, useDefaultPipelineStageSummary } from "./queries";
import type { OpportunityListResponse } from "../opportunity/types";
import type { PipelineListResponse } from "../pipeline/types";
import type { StageListResponse } from "../stage/types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/api/opportunities`;
const pipelinesUrl = `${env.apiUrl}/api/pipelines`;
const stagesUrl = `${env.apiUrl}/api/stages`;
const usersUrl = `${env.apiUrl}/api/users`;
const summaryUrl = `${env.apiUrl}/api/opportunities/dashboard-summary`;

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
    data: [makeOpportunity()],
    pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
    ...overrides,
  };
}

describe("useDashboardSummary", () => {
  it("pide GET /opportunities/dashboard-summary sin query params y devuelve el resumen tal cual", async () => {
    const captured: URL[] = [];
    server.use(
      http.get(summaryUrl, ({ request }) => {
        captured.push(new URL(request.url));
        return HttpResponse.json(makeDashboardSummary({ openCount: 7 }));
      }),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.search).toBe("");
    expect(result.current.data?.openCount).toBe(7);
    expect(result.current.data?.revenueByMonth).toHaveLength(6);
  });

  it("error: se refleja como isError, sin datos inventados", async () => {
    server.use(
      http.get(summaryUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("dos consumidores en el mismo QueryClient comparten un único request", async () => {
    let requests = 0;
    server.use(
      http.get(summaryUrl, () => {
        requests += 1;
        return HttpResponse.json(makeDashboardSummary());
      }),
    );

    const wrapper = wrapperFor(newClient());
    const first = renderHook(() => useDashboardSummary(), { wrapper });
    const second = renderHook(() => useDashboardSummary(), { wrapper });

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

    const { result } = renderHook(() => useDashboardSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(otherRequests).toBe(0);
  });
});

describe("useDefaultPipelineStageSummary", () => {
  function pipelinesResponse(
    pipelines = [makePipeline({ id: "pl1", isDefault: true })],
  ): PipelineListResponse {
    return {
      data: pipelines,
      pagination: { page: 1, pageSize: 100, total: pipelines.length, totalPages: 1 },
    };
  }

  function stagesResponse(stages: ReturnType<typeof makeStage>[]): StageListResponse {
    return {
      data: stages,
      pagination: { page: 1, pageSize: 100, total: stages.length, totalPages: 1 },
    };
  }

  it("encuentra el Pipeline con isDefault=true aunque no sea el primero de la lista", async () => {
    server.use(
      http.get(pipelinesUrl, () =>
        HttpResponse.json(
          pipelinesResponse([
            makePipeline({ id: "pl-a", isDefault: false }),
            makePipeline({ id: "pl-b", isDefault: true }),
          ]),
        ),
      ),
      http.get(stagesUrl, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("pipelineId")).toBe("pl-b");
        return HttpResponse.json(stagesResponse([]));
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.hasDefaultPipeline).toBe(true));
  });

  it("sin Pipeline default: hasDefaultPipeline=false, no dispara GET /stages ni conteos de Opportunities", async () => {
    let stagesRequests = 0;
    let opportunityRequests = 0;
    server.use(
      http.get(pipelinesUrl, () =>
        HttpResponse.json(pipelinesResponse([makePipeline({ id: "pl1", isDefault: false })])),
      ),
      http.get(stagesUrl, () => {
        stagesRequests += 1;
        return HttpResponse.json(stagesResponse([]));
      }),
      http.get(opportunitiesUrl, () => {
        opportunityRequests += 1;
        return HttpResponse.json(opportunityListResponse());
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isLoadingPipelines).toBe(false));
    expect(result.current.hasDefaultPipeline).toBe(false);
    expect(stagesRequests).toBe(0);
    expect(opportunityRequests).toBe(0);
  });

  it("obtiene Stages únicamente del Pipeline default, ordenadas por order ASC", async () => {
    const stagesParams: URLSearchParams[] = [];
    server.use(
      http.get(pipelinesUrl, () => HttpResponse.json(pipelinesResponse())),
      http.get(stagesUrl, ({ request }) => {
        stagesParams.push(new URL(request.url).searchParams);
        return HttpResponse.json(stagesResponse([makeStage({ id: "st1", pipelineId: "pl1" })]));
      }),
      http.get(opportunitiesUrl, () => HttpResponse.json(opportunityListResponse())),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.stages.length).toBe(1));
    expect(stagesParams[0]?.get("pipelineId")).toBe("pl1");
    expect(stagesParams[0]?.get("sortBy")).toBe("order");
    expect(stagesParams[0]?.get("sortOrder")).toBe("asc");
  });

  it("los conteos por Stage usan pipelineId+stageId y pagination.total (nunca items.length)", async () => {
    const capturedParams: URLSearchParams[] = [];
    server.use(
      http.get(pipelinesUrl, () => HttpResponse.json(pipelinesResponse())),
      http.get(stagesUrl, () =>
        HttpResponse.json(
          stagesResponse([
            makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto", order: 1 }),
            makeStage({ id: "st2", pipelineId: "pl1", name: "Negociación", order: 2 }),
          ]),
        ),
      ),
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        capturedParams.push(url.searchParams);
        const stageId = url.searchParams.get("stageId");
        const total = stageId === "st1" ? 4 : 0;
        return HttpResponse.json(
          opportunityListResponse({
            data: [makeOpportunity(), makeOpportunity(), makeOpportunity()],
            pagination: { page: 1, pageSize: 1, total, totalPages: total },
          }),
        );
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => {
      expect(result.current.stages.length).toBe(2);
      expect(result.current.stages.every((s) => !s.isLoading)).toBe(true);
    });

    const byId = new Map(result.current.stages.map((s) => [s.stageId, s]));
    expect(byId.get("st1")?.total).toBe(4);
    expect(byId.get("st1")?.total).not.toBe(3); // no items.length
    expect(byId.get("st2")?.total).toBe(0);
    for (const params of capturedParams) {
      expect(params.get("pipelineId")).toBe("pl1");
      expect(["st1", "st2"]).toContain(params.get("stageId"));
    }
  });

  it("Pipeline default sin Stages: stages queda vacío, sin error", async () => {
    server.use(
      http.get(pipelinesUrl, () => HttpResponse.json(pipelinesResponse())),
      http.get(stagesUrl, () => HttpResponse.json(stagesResponse([]))),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isLoadingStages).toBe(false));
    expect(result.current.isErrorStages).toBe(false);
    expect(result.current.stages).toEqual([]);
  });

  it("error de pipelines: isErrorPipelines=true, sin default, sin request de stages", async () => {
    let stagesRequests = 0;
    server.use(
      http.get(pipelinesUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
      http.get(stagesUrl, () => {
        stagesRequests += 1;
        return HttpResponse.json(stagesResponse([]));
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isErrorPipelines).toBe(true));
    expect(result.current.hasDefaultPipeline).toBe(false);
    expect(stagesRequests).toBe(0);
  });

  it("error de stages: isErrorStages=true, stages queda vacío (sin conteos inventados)", async () => {
    server.use(
      http.get(pipelinesUrl, () => HttpResponse.json(pipelinesResponse())),
      http.get(stagesUrl, () =>
        HttpResponse.json({ error: { message: "caída" } }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isErrorStages).toBe(true));
    expect(result.current.stages).toEqual([]);
  });

  it("error parcial de un conteo: solo ese Stage queda en error, el resto conserva su total", async () => {
    server.use(
      http.get(pipelinesUrl, () => HttpResponse.json(pipelinesResponse())),
      http.get(stagesUrl, () =>
        HttpResponse.json(
          stagesResponse([
            makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto", order: 1 }),
            makeStage({ id: "st2", pipelineId: "pl1", name: "Negociación", order: 2 }),
          ]),
        ),
      ),
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("stageId") === "st1") {
          return HttpResponse.json({ error: { message: "caída" } }, { status: 500 });
        }
        return HttpResponse.json(
          opportunityListResponse({
            pagination: { page: 1, pageSize: 1, total: 9, totalPages: 9 },
          }),
        );
      }),
    );

    const { result } = renderHook(() => useDefaultPipelineStageSummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() =>
      expect(result.current.stages.find((s) => s.stageId === "st1")?.isError).toBe(true),
    );
    const byId = new Map(result.current.stages.map((s) => [s.stageId, s]));
    expect(byId.get("st1")?.total).toBeNull();
    expect(byId.get("st2")?.isError).toBe(false);
    expect(byId.get("st2")?.total).toBe(9);
  });
});
