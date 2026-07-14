import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { createContact, deleteContact, listContacts, updateContact } from "./api";
import type { ContactListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/contacts`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeContact();
  const listResponse: ContactListResponse = {
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

describe("contact/api — contrato HTTP", () => {
  it("serializa page/pageSize/search/companyId/ownerId/lifecycleStage/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listContacts({
      page: 2,
      pageSize: 10,
      search: "juana",
      companyId: "co-1",
      ownerId: "user-9",
      lifecycleStage: "MQL",
      sortBy: "firstName",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("juana");
    expect(params.get("companyId")).toBe("co-1");
    expect(params.get("ownerId")).toBe("user-9");
    expect(params.get("lifecycleStage")).toBe("MQL");
    expect(params.get("sortBy")).toBe("firstName");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("organizationId nunca viaja en list/create/update (request real interceptada)", async () => {
    const captured = captureRequests();

    await listContacts({ page: 1, pageSize: 20 });
    await createContact({ firstName: "Juana", lastName: "Pérez" });
    await updateContact("ct1", { firstName: "Juana 2" });

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

  it("createContact hace POST con el payload correcto, incluidos companyId/ownerId si se proveen", async () => {
    const captured = captureRequests();

    await createContact({
      firstName: "Juana",
      lastName: "Pérez",
      companyId: "co-1",
      ownerId: "user-9",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/contacts");
    expect(captured[0].body).toEqual({
      firstName: "Juana",
      lastName: "Pérez",
      companyId: "co-1",
      ownerId: "user-9",
    });
  });

  it("updateContact hace PATCH sobre el id correcto, sin inventar companyId/ownerId: null", async () => {
    const captured = captureRequests();

    await updateContact("ct1", { lifecycleStage: "CUSTOMER" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/contacts/ct1");
    expect(captured[0].body).toEqual({ lifecycleStage: "CUSTOMER" });
    expect(captured[0].body).not.toHaveProperty("companyId");
    expect(captured[0].body).not.toHaveProperty("ownerId");
  });

  it("deleteContact hace DELETE sobre el id correcto", async () => {
    const captured = captureRequests();

    await deleteContact("ct1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/contacts/ct1");
  });
});
