import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { deleteUser, listUsers, updateUser } from "./api";
import type { UserListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/users`;

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
    expect(captured[0].url.pathname).toBe("/api/users");
  });
});

describe("user/api — updateUser/deleteUser (M7)", () => {
  it("B.1 updateUser(role) hace PATCH con el payload exacto, sin isActive", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    let capturedPath: string | undefined;
    server.use(
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        capturedPath = new URL(request.url).pathname;
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeUser({ id: params.id as string, role: { id: "role-admin", name: "ADMIN", description: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } }));
      }),
    );

    const result = await updateUser("u1", { role: "ADMIN" });

    expect(capturedPath).toBe("/api/users/u1");
    expect(patchedBody).toEqual({ role: "ADMIN" });
    expect(result.role.name).toBe("ADMIN");
  });

  it("B.2 updateUser(isActive) hace PATCH con el payload exacto, sin role", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeUser());
      }),
    );

    await updateUser("u1", { isActive: false });

    expect(patchedBody).toEqual({ isActive: false });
  });

  it("B.3 updateUser nunca envía email/fullName/id/organizationId (no son campos del tipo)", async () => {
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.patch(`${baseUrl}/:id`, async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makeUser());
      }),
    );

    await updateUser("u1", { role: "USER", isActive: true });

    expect(patchedBody).not.toHaveProperty("email");
    expect(patchedBody).not.toHaveProperty("fullName");
    expect(patchedBody).not.toHaveProperty("id");
    expect(patchedBody).not.toHaveProperty("organizationId");
  });

  it("B.4 deleteUser hace DELETE sobre el id correcto", async () => {
    let capturedMethod: string | undefined;
    let capturedPath: string | undefined;
    server.use(
      http.delete(`${baseUrl}/:id`, ({ request }) => {
        capturedMethod = request.method;
        capturedPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const result = await deleteUser("u1");

    expect(capturedMethod).toBe("DELETE");
    expect(capturedPath).toBe("/api/users/u1");
    expect(result).toBeUndefined();
  });

  it("B.5 updateUser propaga el error real del backend (400 último-admin)", async () => {
    server.use(
      http.patch(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "No se puede modificar al último ADMIN activo de la organización" } },
          { status: 400 },
        ),
      ),
    );

    await expect(updateUser("u1", { role: "USER" })).rejects.toThrow(
      "No se puede modificar al último ADMIN activo de la organización",
    );
  });

  it("B.6 deleteUser propaga el error real del backend (400 auto-eliminación)", async () => {
    server.use(
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "No podés eliminar tu propio usuario" } },
          { status: 400 },
        ),
      ),
    );

    await expect(deleteUser("u1")).rejects.toThrow("No podés eliminar tu propio usuario");
  });
});
