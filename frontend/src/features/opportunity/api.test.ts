import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import {
  createOpportunity,
  deleteOpportunity,
  getOpportunity,
  listOpportunities,
  updateOpportunity,
} from "./api";
import type { OpportunityListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/opportunities`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeOpportunity();
  const listResponse: OpportunityListResponse = {
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

describe("opportunity/api — contrato HTTP", () => {
  it("A.1 listOpportunities serializa todos los filtros soportados por el contrato", async () => {
    const captured = captureRequests();

    await listOpportunities({
      page: 2,
      pageSize: 10,
      search: "renovación",
      companyId: "co1",
      contactId: "ct1",
      ownerId: "u1",
      pipelineId: "pl1",
      stageId: "st1",
      status: "OPEN",
      currency: "USD",
      minAmount: 100,
      maxAmount: 5000,
      sortBy: "amount",
      sortOrder: "desc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("renovación");
    expect(params.get("companyId")).toBe("co1");
    expect(params.get("contactId")).toBe("ct1");
    expect(params.get("ownerId")).toBe("u1");
    expect(params.get("pipelineId")).toBe("pl1");
    expect(params.get("stageId")).toBe("st1");
    expect(params.get("status")).toBe("OPEN");
    expect(params.get("currency")).toBe("USD");
    expect(params.get("minAmount")).toBe("100");
    expect(params.get("maxAmount")).toBe("5000");
    expect(params.get("sortBy")).toBe("amount");
    expect(params.get("sortOrder")).toBe("desc");
  });

  it("A.2 omite params no provistos", async () => {
    const captured = captureRequests();

    await listOpportunities({ page: 1, pageSize: 20 });

    expect(captured).toHaveLength(1);
    expect(captured[0].url.search).toBe("?page=1&pageSize=20");
  });

  it("A.3 organizationId nunca viaja en list/get/create/update (request real interceptada)", async () => {
    const captured = captureRequests();

    await listOpportunities({ page: 1, pageSize: 20 });
    await getOpportunity("op1");
    await createOpportunity({
      title: "Nueva",
      pipelineId: "pl1",
      stageId: "st1",
      companyId: "co1",
    });
    await updateOpportunity("op1", { title: "Editada" });

    expect(captured).toHaveLength(4);
    for (const req of captured) {
      expect(req.url.search.toLowerCase()).not.toContain("organizationid");
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain("organizationId");
      }
    }
  });

  it("A.4 createOpportunity hace POST con el payload correcto, amount como number", async () => {
    const captured = captureRequests();

    await createOpportunity({
      title: "Nueva",
      pipelineId: "pl1",
      stageId: "st1",
      companyId: "co1",
      amount: 1500,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/api/opportunities");
    expect(captured[0].body).toEqual({
      title: "Nueva",
      pipelineId: "pl1",
      stageId: "st1",
      companyId: "co1",
      amount: 1500,
    });
    expect(typeof (captured[0].body as Record<string, unknown>).amount).toBe("number");
  });

  it("A.5 updateOpportunity hace PATCH sobre el id correcto, sin agregar campos no enviados", async () => {
    const captured = captureRequests();

    await updateOpportunity("op1", { status: "WON" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/opportunities/op1");
    expect(captured[0].body).toEqual({ status: "WON" });
  });

  it("A.6 updateOpportunity envía null explícito para limpiar expectedCloseDate/actualCloseDate/lostReason", async () => {
    const captured = captureRequests();

    await updateOpportunity("op1", {
      expectedCloseDate: null,
      actualCloseDate: null,
      lostReason: null,
    });

    expect(captured[0].body).toEqual({
      expectedCloseDate: null,
      actualCloseDate: null,
      lostReason: null,
    });
  });

  it("A.7 deleteOpportunity hace DELETE sobre el id correcto y maneja 204 sin body", async () => {
    const captured = captureRequests();

    const result = await deleteOpportunity("op1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/api/opportunities/op1");
    expect(result).toBeUndefined();
  });

  it("A.8 getOpportunity devuelve amount como string, fiel al contrato real (Decimal)", async () => {
    server.use(
      http.get(`${baseUrl}/op1`, () =>
        HttpResponse.json(makeOpportunity({ id: "op1", amount: "1234.50" })),
      ),
    );

    const opportunity = await getOpportunity("op1");

    expect(opportunity.amount).toBe("1234.50");
    expect(typeof opportunity.amount).toBe("string");
  });
});
