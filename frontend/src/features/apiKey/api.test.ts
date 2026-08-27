import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeApiKey, makeCreatedApiKey } from "../../test/apiKeyFixtures";
import { createApiKey, listApiKeys, revokeApiKey } from "./api";
import type { ApiKeyListResponse } from "./types";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/api-keys`;

describe("apiKey/api — contrato HTTP", () => {
  it("listApiKeys serializa sourceId, status, paginación y orden", async () => {
    let url: URL | undefined;
    const listResponse: ApiKeyListResponse = {
      data: [makeApiKey()],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    server.use(
      http.get(baseUrl, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(listResponse);
      }),
    );

    await listApiKeys({
      page: 3,
      pageSize: 50,
      sourceId: "src1",
      status: "REVOKED",
      sortBy: "lastUsedAt",
      sortOrder: "asc",
    });

    expect(url?.pathname).toBe("/api/api-keys");
    expect(url?.searchParams.get("page")).toBe("3");
    expect(url?.searchParams.get("pageSize")).toBe("50");
    expect(url?.searchParams.get("sourceId")).toBe("src1");
    expect(url?.searchParams.get("status")).toBe("REVOKED");
    expect(url?.searchParams.get("sortBy")).toBe("lastUsedAt");
    expect(url?.searchParams.get("sortOrder")).toBe("asc");
  });

  it("los filtros omitidos no viajan", async () => {
    let url: URL | undefined;
    server.use(
      http.get(baseUrl, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );

    await listApiKeys({ page: 1 });
    expect(url?.searchParams.has("sourceId")).toBe(false);
    expect(url?.searchParams.has("status")).toBe(false);
  });

  it("createApiKey manda POST con solo sourceId y recibe la clave en claro", async () => {
    let body: unknown;
    server.use(
      http.post(baseUrl, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeCreatedApiKey({ key: "crm_secreto" }), { status: 201 });
      }),
    );

    const creada = await createApiKey({ sourceId: "src1" });

    expect(body).toEqual({ sourceId: "src1" });
    expect(creada.key).toBe("crm_secreto");
  });

  it("revokeApiKey manda DELETE y LEE EL BODY del 200 — no es un 204", async () => {
    // Desviación deliberada del backend respecto de sus otros DELETE: devuelve
    // 200 con la clave ya revocada. Si el frontend asumiera 204 perdería el dato.
    server.use(
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json(makeApiKey({ id: "ak9", revokedAt: "2026-02-02T00:00:00.000Z" })),
      ),
    );

    const revocada = await revokeApiKey("ak9");
    expect(revocada.id).toBe("ak9");
    expect(revocada.revokedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("revocar dos veces: el 409 se propaga con su mensaje", async () => {
    server.use(
      http.delete(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "Esta clave ya fue revocada" } }, { status: 409 }),
      ),
    );

    await expect(revokeApiKey("ak1")).rejects.toThrow("Esta clave ya fue revocada");
  });
});
