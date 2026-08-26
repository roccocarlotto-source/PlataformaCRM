import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeInvitation } from "../../test/invitationFixtures";
import { createInvitation, listInvitations, revokeInvitation } from "./api";
import type { InvitationListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/invitations`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeInvitation();
  const listResponse: InvitationListResponse = {
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
    http.delete(`${baseUrl}/:id`, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return HttpResponse.json({ ...sample, status: "REVOKED" });
    }),
  );

  return captured;
}

describe("invitation/api — contrato HTTP", () => {
  it("1. listInvitations serializa page/pageSize/status/sortBy/sortOrder", async () => {
    const captured = captureRequests();

    await listInvitations({
      page: 2,
      pageSize: 10,
      status: "PENDING",
      sortBy: "expiresAt",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("status")).toBe("PENDING");
    expect(params.get("sortBy")).toBe("expiresAt");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("2. omite params no provistos", async () => {
    const captured = captureRequests();

    await listInvitations({});

    expect(captured[0].url.search).toBe("");
  });

  it("3. createInvitation envía email + role, nunca roleId ni organizationId", async () => {
    const captured = captureRequests();

    await createInvitation({ email: "nueva@example.com", role: "USER" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/api/invitations");
    expect(captured[0].body).toEqual({ email: "nueva@example.com", role: "USER" });
    expect(Object.keys(captured[0].body as Record<string, unknown>)).not.toContain("roleId");
    expect(Object.keys(captured[0].body as Record<string, unknown>)).not.toContain(
      "organizationId",
    );
  });

  it("4. organizationId nunca viaja en list/create/revoke", async () => {
    const captured = captureRequests();

    await listInvitations({});
    await createInvitation({ email: "x@example.com", role: "USER" });
    await revokeInvitation("inv1");

    expect(captured).toHaveLength(3);
    for (const req of captured) {
      expect(req.url.search.toLowerCase()).not.toContain("organizationid");
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain("organizationId");
      }
    }
  });

  it("5. revokeInvitation hace DELETE sobre el id correcto y devuelve la invitación con status REVOKED", async () => {
    const captured = captureRequests();

    const result = await revokeInvitation("inv1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/api/invitations/inv1");
    expect(result.status).toBe("REVOKED");
  });

  it("6. createInvitation propaga el error real del backend (409 duplicado)", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json(
          { error: { message: "Ya existe una invitación pendiente para ese email" } },
          { status: 409 },
        ),
      ),
    );

    await expect(createInvitation({ email: "dup@example.com", role: "USER" })).rejects.toThrow(
      "Ya existe una invitación pendiente para ese email",
    );
  });

  it("7. revokeInvitation propaga el error real del backend (409 ya aceptada)", async () => {
    server.use(
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json(
          { error: { message: "Esta invitación ya fue aceptada, no se puede revocar" } },
          { status: 409 },
        ),
      ),
    );

    await expect(revokeInvitation("inv1")).rejects.toThrow(
      "Esta invitación ya fue aceptada, no se puede revocar",
    );
  });

  it("8. listInvitations devuelve roleId/invitedById como los UUID crudos del contrato real (sin resolver acá)", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({
          data: [makeInvitation({ roleId: "role-abc", invitedById: "user-xyz" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      ),
    );

    const result = await listInvitations({});

    expect(result.data[0].roleId).toBe("role-abc");
    expect(result.data[0].invitedById).toBe("user-xyz");
  });
});
