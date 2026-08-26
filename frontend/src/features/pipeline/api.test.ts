import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { createPipeline, deletePipeline, listPipelines, updatePipeline } from "./api";
import type { PipelineListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/pipelines`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makePipeline();
  const listResponse: PipelineListResponse = {
    data: [sample],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  };

  server.use(
    http.get(baseUrl, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return HttpResponse.json(listResponse);
    }),
    http.post(baseUrl, async ({ request }) => {
      const body = await request.clone().json();
      captured.push({ method: request.method, url: new URL(request.url), body });
      return HttpResponse.json(sample, { status: 201 });
    }),
    http.patch(`${baseUrl}/:id`, async ({ request }) => {
      const body = await request.clone().json();
      captured.push({ method: request.method, url: new URL(request.url), body });
      return HttpResponse.json(sample);
    }),
    http.delete(`${baseUrl}/:id`, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return new HttpResponse(null, { status: 204 });
    }),
  );

  return captured;
}

describe("pipeline/api — contrato HTTP", () => {
  it("P1 listPipelines serializa page/pageSize/search/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listPipelines({
      page: 2,
      pageSize: 10,
      search: "ventas",
      sortBy: "name",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("ventas");
    expect(params.get("sortBy")).toBe("name");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("P2 organizationId nunca viaja en list/create/update (request real interceptada)", async () => {
    const captured = captureRequests();

    await listPipelines({ page: 1, pageSize: 20 });
    await createPipeline({ name: "Ventas" });
    await updatePipeline("pl1", { name: "Ventas 2" });

    expect(captured).toHaveLength(3);
    for (const req of captured) {
      expect(req.url.search.toLowerCase()).not.toContain("organizationid");
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain("organizationId");
      }
    }
  });

  it("P3 createPipeline hace POST con el payload correcto, incluido isDefault", async () => {
    const captured = captureRequests();

    await createPipeline({ name: "Ventas", isDefault: true });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/api/pipelines");
    expect(captured[0].body).toEqual({ name: "Ventas", isDefault: true });
  });

  it("P4 updatePipeline hace PATCH sobre el id correcto", async () => {
    const captured = captureRequests();

    await updatePipeline("pl1", { isDefault: false });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/pipelines/pl1");
    expect(captured[0].body).toEqual({ isDefault: false });
  });

  it("P5 deletePipeline hace DELETE sobre el id correcto", async () => {
    const captured = captureRequests();

    await deletePipeline("pl1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/api/pipelines/pl1");
  });
});
