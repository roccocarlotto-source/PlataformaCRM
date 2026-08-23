import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import {
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  updateActivity,
} from "./api";
import type { ActivityListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/activities`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeActivity();
  const listResponse: ActivityListResponse = {
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

describe("activity/api — contrato HTTP", () => {
  it("1. listActivities serializa todos los filtros reales soportados", async () => {
    const captured = captureRequests();

    await listActivities({
      page: 2,
      pageSize: 10,
      search: "renovación",
      type: "CALL",
      authorId: "u1",
      assigneeId: "u2",
      companyId: "co1",
      contactId: "ct1",
      opportunityId: "op1",
      dueDateFrom: "2026-01-01T00:00:00.000Z",
      dueDateTo: "2026-01-31T00:00:00.000Z",
      completedAtFrom: "2026-01-01T00:00:00.000Z",
      completedAtTo: "2026-01-31T00:00:00.000Z",
      sortBy: "dueDate",
      sortOrder: "asc",
    });

    expect(captured).toHaveLength(1);
    const params = captured[0].url.searchParams;
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("renovación");
    expect(params.get("type")).toBe("CALL");
    expect(params.get("authorId")).toBe("u1");
    expect(params.get("assigneeId")).toBe("u2");
    expect(params.get("companyId")).toBe("co1");
    expect(params.get("contactId")).toBe("ct1");
    expect(params.get("opportunityId")).toBe("op1");
    expect(params.get("dueDateFrom")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("dueDateTo")).toBe("2026-01-31T00:00:00.000Z");
    expect(params.get("completedAtFrom")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("completedAtTo")).toBe("2026-01-31T00:00:00.000Z");
    expect(params.get("sortBy")).toBe("dueDate");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("2. omite params no provistos", async () => {
    const captured = captureRequests();

    await listActivities({ page: 1, pageSize: 20 });

    expect(captured).toHaveLength(1);
    expect(captured[0].url.search).toBe("?page=1&pageSize=20");
  });

  it("3. getActivity pega a GET /activities/:id", async () => {
    const captured = captureRequests();

    await getActivity("act1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("GET");
    expect(captured[0].url.pathname).toBe("/api/activities/act1");
  });

  it("4. organizationId nunca viaja en list/get/create/update", async () => {
    const captured = captureRequests();

    await listActivities({ page: 1, pageSize: 20 });
    await getActivity("act1");
    await createActivity({ type: "CALL", subject: "Nueva", companyId: "co1" });
    await updateActivity("act1", { subject: "Editada" });

    expect(captured).toHaveLength(4);
    for (const req of captured) {
      expect(req.url.search.toLowerCase()).not.toContain("organizationid");
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain("organizationId");
      }
    }
  });

  it("5. authorId nunca viaja en create/update (no existe en el shape del input)", async () => {
    const captured = captureRequests();

    await createActivity({ type: "CALL", subject: "Nueva", companyId: "co1" });
    await updateActivity("act1", { subject: "Editada" });

    for (const req of captured) {
      if (req.body && typeof req.body === "object") {
        expect(Object.keys(req.body as Record<string, unknown>)).not.toContain("authorId");
      }
    }
  });

  it("6. createActivity hace POST con el payload exacto", async () => {
    const captured = captureRequests();

    await createActivity({
      type: "TASK",
      subject: "Llamar",
      companyId: "co1",
      dueDate: "2026-02-01T12:00:00.000Z",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url.pathname).toBe("/api/activities");
    expect(captured[0].body).toEqual({
      type: "TASK",
      subject: "Llamar",
      companyId: "co1",
      dueDate: "2026-02-01T12:00:00.000Z",
    });
  });

  it("7. updateActivity hace PATCH sobre el id correcto, sin agregar campos no enviados", async () => {
    const captured = captureRequests();

    await updateActivity("act1", { subject: "Editada" });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/activities/act1");
    expect(captured[0].body).toEqual({ subject: "Editada" });
  });

  it("8. updateActivity envía null explícito para limpiar body/dueDate/completedAt/assigneeId/companyId/contactId/opportunityId", async () => {
    const captured = captureRequests();

    await updateActivity("act1", {
      body: null,
      dueDate: null,
      completedAt: null,
      assigneeId: null,
      companyId: null,
      contactId: null,
      opportunityId: null,
    });

    expect(captured[0].body).toEqual({
      body: null,
      dueDate: null,
      completedAt: null,
      assigneeId: null,
      companyId: null,
      contactId: null,
      opportunityId: null,
    });
  });

  it("9. deleteActivity hace DELETE sobre el id correcto y maneja 204 sin body", async () => {
    const captured = captureRequests();

    const result = await deleteActivity("act1");

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url.pathname).toBe("/api/activities/act1");
    expect(result).toBeUndefined();
  });

  it("10. getActivity devuelve dueDate/completedAt como ISO con hora, fiel al contrato real", async () => {
    server.use(
      http.get(`${baseUrl}/act1`, () =>
        HttpResponse.json(
          makeActivity({ id: "act1", dueDate: "2026-03-01T14:30:00.000Z" }),
        ),
      ),
    );

    const activity = await getActivity("act1");

    expect(activity.dueDate).toBe("2026-03-01T14:30:00.000Z");
  });
});
