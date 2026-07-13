import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { createCompany, deleteCompany, listCompanies, updateCompany } from "./api";
import type { CompanyListResponse } from "./types";

// getAccessToken es la única frontera externa real de este módulo (vía
// Supabase) — se mockea acá igual que en auth/AuthContext.test.tsx.
// request()/ApiError corren sin mockear, contra MSW.
vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/companies`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

// Registra handlers para los 4 verbos y devuelve el array donde se van
// acumulando las requests REALES que efectivamente llegaron a MSW — no es
// un grep estático, es una aserción sobre el tráfico interceptado.
function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeCompany();
  const listResponse: CompanyListResponse = {
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

describe("company/api — contrato HTTP", () => {
  it("A.1 listCompanies serializa page/pageSize/search/industry/ownerId/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listCompanies({
      page: 2,
      pageSize: 10,
      search: "acme",
      industry: "tech",
      ownerId: "user-42",
      sortBy: "name",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("acme");
    expect(params.get("industry")).toBe("tech");
    expect(params.get("ownerId")).toBe("user-42");
    expect(params.get("sortBy")).toBe("name");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("A.2 organizationId nunca viaja en list/create/update (request real interceptada)", async () => {
    const captured = captureRequests();

    await listCompanies({ page: 1, pageSize: 20 });
    await createCompany({ name: "Acme" });
    await updateCompany("c1", { name: "Acme 2" });

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

  it("A.3 createCompany hace POST con el payload correcto, incluido ownerId si se provee", async () => {
    const captured = captureRequests();

    await createCompany({ name: "Acme", ownerId: "user-7" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/companies");
    expect(captured[0].body).toEqual({ name: "Acme", ownerId: "user-7" });
  });

  it("A.4 updateCompany hace PATCH sobre el id correcto, sin inventar ownerId: null", async () => {
    const captured = captureRequests();

    await updateCompany("c1", { industry: "finance" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/companies/c1");
    expect(captured[0].body).toEqual({ industry: "finance" });
    expect(captured[0].body).not.toHaveProperty("ownerId");
  });

  it("A.5 deleteCompany hace DELETE sobre el id correcto", async () => {
    const captured = captureRequests();

    await deleteCompany("c1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/companies/c1");
  });
});
