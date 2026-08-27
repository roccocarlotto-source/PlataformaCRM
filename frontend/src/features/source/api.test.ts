import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeSource } from "../../test/sourceFixtures";
import { createSource, deleteSource, getSource, listSources, updateSource } from "./api";
import type { SourceListResponse } from "./types";

// getAccessToken es la única frontera externa real de este módulo (vía
// Supabase) — se mockea acá igual que en company/api.test.ts.
// request()/ApiError corren sin mockear, contra MSW.
vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/sources`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeSource();
  const listResponse: SourceListResponse = {
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

describe("source/api — contrato HTTP", () => {
  it("listSources serializa los cinco filtros y la paginación", async () => {
    const captured = captureRequests();
    await listSources({
      page: 2,
      pageSize: 10,
      search: "landing",
      type: "FILE_IMPORT",
      isActive: true,
      sortBy: "name",
      sortOrder: "asc",
    });

    const params = captured[0].url.searchParams;
    expect(captured[0].url.pathname).toBe("/api/sources");
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("10");
    expect(params.get("search")).toBe("landing");
    expect(params.get("type")).toBe("FILE_IMPORT");
    expect(params.get("isActive")).toBe("true");
    expect(params.get("sortBy")).toBe("name");
    expect(params.get("sortOrder")).toBe("asc");
  });

  it("isActive: false SÍ viaja — es un filtro, no la ausencia de uno", () => {
    // El bug que este test previene: un `if (query.isActive)` se comería el
    // filtro de "pausadas", que es el más útil de los dos.
    const captured = captureRequests();
    return listSources({ isActive: false }).then(() => {
      expect(captured[0].url.searchParams.get("isActive")).toBe("false");
    });
  });

  it("los filtros omitidos no viajan como cadenas vacías", async () => {
    const captured = captureRequests();
    await listSources({ page: 1 });

    const params = captured[0].url.searchParams;
    expect(params.has("search")).toBe(false);
    expect(params.has("type")).toBe(false);
    expect(params.has("isActive")).toBe(false);
  });

  it("getSource pide /sources/:id", async () => {
    const captured = captureRequests();
    await getSource("src1");
    expect(captured[0].url.pathname).toBe("/api/sources/src1");
  });

  it("createSource manda POST con el body tal cual", async () => {
    const captured = captureRequests();
    await createSource({
      name: "Planilla feria",
      type: "FILE_IMPORT",
      isActive: true,
      fieldMapping: { Nombre: "firstName" },
    });

    expect(captured[0].method).toBe("POST");
    expect(captured[0].body).toEqual({
      name: "Planilla feria",
      type: "FILE_IMPORT",
      isActive: true,
      fieldMapping: { Nombre: "firstName" },
    });
  });

  it("updateSource manda PATCH, y fieldMapping: null viaja como null (limpia el mapeo)", async () => {
    const captured = captureRequests();
    await updateSource("src1", { name: "Otro nombre", fieldMapping: null });

    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/sources/src1");
    expect(captured[0].body).toEqual({ name: "Otro nombre", fieldMapping: null });
  });

  it("deleteSource manda DELETE y tolera el 204 sin body", async () => {
    const captured = captureRequests();
    await expect(deleteSource("src1")).resolves.toBeUndefined();
    expect(captured[0].method).toBe("DELETE");
  });

  it("un error del backend se propaga con su mensaje", async () => {
    server.use(
      http.get(baseUrl, () =>
        HttpResponse.json({ error: { message: "Fuente no encontrada" } }, { status: 404 }),
      ),
    );
    await expect(listSources({})).rejects.toThrow("Fuente no encontrada");
  });
});
