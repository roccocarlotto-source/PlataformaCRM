import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { listUsers } from "./api";
import type { UserListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/users`;

interface CapturedRequest {
  method: string;
  url: URL;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const listResponse: UserListResponse = {
    data: [makeUser()],
    pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
  };

  server.use(
    http.get(baseUrl, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url) });
      return HttpResponse.json(listResponse);
    }),
  );

  return captured;
}

describe("user/api — contrato HTTP", () => {
  it("A.1 listUsers serializa page/pageSize/role/isActive/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listUsers({
      page: 1,
      pageSize: 100,
      role: "ADMIN",
      isActive: true,
      sortBy: "fullName",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("100");
    expect(params.get("role")).toBe("ADMIN");
    expect(params.get("isActive")).toBe("true");
    expect(params.get("sortBy")).toBe("fullName");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("A.2 omite params no provistos", async () => {
    const captured = captureRequests();

    await listUsers({});

    expect(captured).toHaveLength(1);
    expect(captured[0].url.search).toBe("");
  });

  it("A.3 organizationId nunca viaja en la request real interceptada", async () => {
    const captured = captureRequests();

    await listUsers({ pageSize: 100, isActive: true, sortBy: "fullName", sortOrder: "asc" });

    expect(captured).toHaveLength(1);
    expect(captured[0].url.search.toLowerCase()).not.toContain("organizationid");
  });

  it("A.4 GET /users apunta al path correcto", async () => {
    const captured = captureRequests();

    await listUsers({ pageSize: 10 });

    expect(captured[0].method).toBe("GET");
    expect(captured[0].url.pathname).toBe("/users");
  });
});
