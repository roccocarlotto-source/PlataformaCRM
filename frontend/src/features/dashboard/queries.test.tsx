import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import {
  useDefaultPipelineStageSummary,
  useMyRecentOpenOpportunities,
  useOpportunitySummary,
} from "./queries";
import type { OpportunityListResponse } from "../opportunity/types";
import type { PipelineListResponse } from "../pipeline/types";
import type { StageListResponse } from "../stage/types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const opportunitiesUrl = `${env.apiUrl}/opportunities`;
const pipelinesUrl = `${env.apiUrl}/pipelines`;
const stagesUrl = `${env.apiUrl}/stages`;
const usersUrl = `${env.apiUrl}/users`;

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

describe("useOpportunitySummary", () => {
  it("OPEN/WON/LOST cada uno consulta con su propio status, y ningún request usa GET /api/users", async () => {
    const captured: string[] = [];
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        captured.push(url.searchParams.get("status") ?? "");
        return HttpResponse.json(
          opportunityListResponse({
            pagination: { page: 1, pageSize: 1, total: 7, totalPages: 7 },
          }),
        );
      }),
    );

    const { result } = renderHook(() => useOpportunitySummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.open.isLoading).toBe(false));
    expect(result.current.won.isLoading).toBe(false);
    expect(result.current.lost.isLoading).toBe(false);

    expect(captured.sort()).toEqual(["LOST", "OPEN", "WON"]);
  });

  it("cada valor usa pagination.total, nunca items.length — data trae 3 filas pero pagination.total=1", async () => {
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json(
          opportunityListResponse({
            data: [makeOpportunity(), makeOpportunity(), makeOpportunity()],
            pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
          }),
        ),
      ),
    );

    const { result } = renderHook(() => useOpportunitySummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.open.total).toBe(1));
    expect(result.current.open.total).not.toBe(3);
  });

  it("0 se muestra correctamente (pagination.total: 0)", async () => {
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json(
          opportunityListResponse({
            data: [],
            pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 },
          }),
        ),
      ),
    );

    const { result } = renderHook(() => useOpportunitySummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.open.isLoading).toBe(false));
    expect(result.current.open.total).toBe(0);
  });

  it("un error en una consulta no inventa un valor y no afecta a las otras", async () => {
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        if (status === "WON") {
          return HttpResponse.json({ error: { message: "fallo" } }, { status: 500 });
        }
        return HttpResponse.json(opportunityListResponse());
      }),
    );

    const { result } = renderHook(() => useOpportunitySummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.won.isError).toBe(true));
    expect(result.current.won.total).toBeNull();
    expect(result.current.open.isError).toBe(false);
    expect(result.current.open.total).toBe(1);
    expect(result.current.lost.isError).toBe(false);
    expect(result.current.lost.total).toBe(1);
  });

  it("no dispara ningún request a GET /api/users", async () => {
    let usersRequestCount = 0;
    server.use(
      http.get(opportunitiesUrl, () => HttpResponse.json(opportunityListResponse())),
      http.get(usersUrl, () => {
        usersRequestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );

    const { result } = renderHook(() => useOpportunitySummary(), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.open.isLoading).toBe(false));
    expect(usersRequestCount).toBe(0);
  });
});

describe("useMyRecentOpenOpportunities", () => {
  it("filtra por ownerId, status=OPEN, sortBy=createdAt, sortOrder=desc y pageSize=5", async () => {
    const captured: URLSearchParams[] = [];
    server.use(
      http.get(opportunitiesUrl, ({ request }) => {
        captured.push(new URL(request.url).searchParams);
        return HttpResponse.json(opportunityListResponse());
      }),
    );

    const { result } = renderHook(() => useMyRecentOpenOpportunities("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured[0]?.get("ownerId")).toBe("u1");
    expect(captured[0]?.get("status")).toBe("OPEN");
    expect(captured[0]?.get("sortBy")).toBe("createdAt");
    expect(captured[0]?.get("sortOrder")).toBe("desc");
    expect(captured[0]?.get("pageSize")).toBe("5");
  });

  it("sin ownerId (undefined) no dispara ningún request — enabled queda en false", async () => {
    let requestCount = 0;
    server.use(
      http.get(opportunitiesUrl, () => {
        requestCount += 1;
        return HttpResponse.json(opportunityListResponse());
      }),
    );

    renderHook(() => useMyRecentOpenOpportunities(undefined), {
      wrapper: wrapperFor(newClient()),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestCount).toBe(0);
  });

  it("empty: data vacía", async () => {
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json({ data: [], pagination: { page: 1, pageSize: 5, total: 0, totalPages: 0 } }),
      ),
    );

    const { result } = renderHook(() => useMyRecentOpenOpportunities("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toEqual([]);
  });

  it("error: se refleja como isError, sin datos inventados", async () => {
    server.use(
      http.get(opportunitiesUrl, () => HttpResponse.json({ error: { message: "caída" } }, { status: 500 })),
    );

    const { result } = renderHook(() => useMyRecentOpenOpportunities("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("datos: refleja exactamente lo que responde la API", async () => {
    server.use(
      http.get(opportunitiesUrl, () =>
        HttpResponse.json(
          opportunityListResponse({ data: [makeOpportunity({ id: "op-recent", title: "Renovación" })] }),
        ),
      ),
    );

    const { result } = renderHook(() => useMyRecentOpenOpportunities("u1"), {
      wrapper: wrapperFor(newClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data[0]?.id).toBe("op-recent");
  });
});

describe("useDefaultPipelineStageSummary", () => {
  function pipelinesResponse(pipelines = [makePipeline({ id: "pl1", isDefault: true })]): PipelineListResponse {
    return { data: pipelines, pagination: { page: 1, pageSize: 100, total: pipelines.length, totalPages: 1 } };
  }

  function stagesResponse(stages: ReturnType<typeof makeStage>[]): StageListResponse {
    return { data: stages, pagination: { page: 1, pageSize: 100, total: stages.length, totalPages: 1 } };
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
      http.get(pipelinesUrl, () => HttpResponse.json({ error: { message: "caída" } }, { status: 500 })),
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
      http.get(stagesUrl, () => HttpResponse.json({ error: { message: "caída" } }, { status: 500 })),
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
          opportunityListResponse({ pagination: { page: 1, pageSize: 1, total: 9, totalPages: 9 } }),
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
