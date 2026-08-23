import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeStage } from "../../test/stageFixtures";
import { createStage, deleteStage, getStage, listStages, updateStage } from "./api";
import type { StageListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/stages`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeStage();
  const listResponse: StageListResponse = {
    data: [sample],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  };

  server.use(
    http.get(baseUrl, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return HttpResponse.json(listResponse);
    }),
    http.get(`${baseUrl}/:id`, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return HttpResponse.json(sample);
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

describe("stage/api — contrato HTTP", () => {
  it("S1 listStages serializa page/pageSize/pipelineId/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listStages({
      page: 1,
      pageSize: 100,
      pipelineId: "pl1",
      sortBy: "order",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("100");
    expect(params.get("pipelineId")).toBe("pl1");
    expect(params.get("sortBy")).toBe("order");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("S2 organizationId nunca viaja en list/create/update (request real interceptada)", async () => {
    const captured = captureRequests();

    await listStages({ pipelineId: "pl1" });
    await createStage({ pipelineId: "pl1", name: "Nueva" });
    await updateStage("st1", { name: "Editada" });

    expect(captured).toHaveLength(3);
    for (const req of captured) {
      expect(req.url.search.toLowerCase()).not.toContain("organizationid");
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain(
          "organizationId",
        );
      }
    }
  });

  it("S3 createStage hace POST con el payload correcto (pipelineId, order, probability, isWon/isLost)", async () => {
    const captured = captureRequests();

    await createStage({
      pipelineId: "pl1",
      name: "Negociación",
      order: 2,
      probability: 50,
      isWon: false,
      isLost: false,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/api/stages");
    expect(captured[0].body).toEqual({
      pipelineId: "pl1",
      name: "Negociación",
      order: 2,
      probability: 50,
      isWon: false,
      isLost: false,
    });
  });

  it("S4 updateStage hace PATCH sobre el id correcto y nunca envía pipelineId", async () => {
    const captured = captureRequests();

    await updateStage("st1", { name: "Editada", order: 3 });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/stages/st1");
    expect(captured[0].body).toEqual({ name: "Editada", order: 3 });
    expect(captured[0].body).not.toHaveProperty("pipelineId");
  });

  it("S5 deleteStage hace DELETE sobre el id correcto", async () => {
    const captured = captureRequests();

    await deleteStage("st1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/api/stages/st1");
  });

  it("S6 round-trip de probability: la API la devuelve como string, nunca number", async () => {
    server.use(http.get(`${baseUrl}/:id`, () => HttpResponse.json(makeStage({ probability: "37.5" }))));

    const stage = await getStage("st1");

    expect(typeof stage.probability).toBe("string");
    expect(stage.probability).toBe("37.5");
    // Nunca NaN al convertir: el string real es siempre numérico.
    expect(Number(stage.probability)).toBe(37.5);
  });
});
