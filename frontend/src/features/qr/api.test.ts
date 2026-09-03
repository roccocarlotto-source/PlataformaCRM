import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeQrCode } from "../../test/qrFixtures";
import { claimQrCode, createDigitalQrCode, deleteQrCode, listQrCodes, updateQrCode } from "./api";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

// Las URLs se afirman con /api adelante: es lo que buildUrl() de lib/api.ts
// agrega y lo que el backend monta (qrRouter en /api). El único path del
// módulo SIN /api es el público de resolución, y ese no pasa por acá (ver
// lib/publicUrl.ts).
const baseUrl = `${env.apiUrl}/api/qr`;

describe("features/qr/api", () => {
  it("listQrCodes: GET /api/qr con los filtros como query string y el Bearer", async () => {
    let captured: Request | undefined;
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured = request;
        return HttpResponse.json({
          data: [makeQrCode()],
          pagination: { page: 2, pageSize: 20, total: 21, totalPages: 2 },
        });
      }),
    );

    const result = await listQrCodes({
      page: 2,
      pageSize: 20,
      branchId: "b1",
      sortBy: "displayNumber",
      sortOrder: "asc",
    });

    const url = new URL(captured!.url);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("20");
    expect(url.searchParams.get("branchId")).toBe("b1");
    expect(url.searchParams.get("sortBy")).toBe("displayNumber");
    expect(url.searchParams.get("sortOrder")).toBe("asc");
    expect(captured!.headers.get("Authorization")).toBe("Bearer test-token");
    expect(result.data).toHaveLength(1);
  });

  it("listQrCodes sin filtros no manda query string", async () => {
    let captured: Request | undefined;
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured = request;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );

    await listQrCodes({});
    expect(new URL(captured!.url).search).toBe("");
  });

  it("createDigitalQrCode: POST /api/qr/digital con el body tal cual", async () => {
    let body: unknown;
    server.use(
      http.post(`${baseUrl}/digital`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode({ qrType: "SINGLE_USE" }), { status: 201 });
      }),
    );

    const created = await createDigitalQrCode({
      branchId: "b1",
      name: "Mostrador",
      destinationUrl: "https://g.page/r/abc/review",
      message: null,
      qrType: "SINGLE_USE",
    });

    expect(body).toEqual({
      branchId: "b1",
      name: "Mostrador",
      destinationUrl: "https://g.page/r/abc/review",
      message: null,
      qrType: "SINGLE_USE",
    });
    expect(created.qrType).toBe("SINGLE_USE");
  });

  it("claimQrCode: POST /api/qr/claim con qrId en el body (nunca en el path)", async () => {
    let body: unknown;
    server.use(
      http.post(`${baseUrl}/claim`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeQrCode(), { status: 201 });
      }),
    );

    await claimQrCode({
      qrId: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11",
      branchId: "b1",
      name: "Mostrador",
      destinationUrl: "https://g.page/r/abc/review",
      message: "Gracias",
    });

    expect(body).toEqual({
      qrId: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11",
      branchId: "b1",
      name: "Mostrador",
      destinationUrl: "https://g.page/r/abc/review",
      message: "Gracias",
    });
  });

  it("claimQrCode: el 409 genérico del backend llega como ApiError con su mensaje", async () => {
    server.use(
      http.post(`${baseUrl}/claim`, () =>
        HttpResponse.json({ error: { message: "QR ya reclamado o no existe" } }, { status: 409 }),
      ),
    );

    await expect(
      claimQrCode({
        qrId: "d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11",
        branchId: "b1",
        name: "x",
        destinationUrl: "https://x.y",
      }),
    ).rejects.toMatchObject({ status: 409, message: "QR ya reclamado o no existe" });
  });

  it("updateQrCode: PATCH /api/qr/:id con solo los campos enviados", async () => {
    let body: unknown;
    let id: string | undefined;
    server.use(
      http.patch(`${baseUrl}/:id`, async ({ request, params }) => {
        id = params.id as string;
        body = await request.json();
        return HttpResponse.json(makeQrCode({ name: "Caja" }));
      }),
    );

    await updateQrCode("d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11", { name: "Caja", message: null });

    expect(id).toBe("d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11");
    expect(body).toEqual({ name: "Caja", message: null });
  });

  it("deleteQrCode: DELETE /api/qr/:id, 204 sin body resuelve a undefined", async () => {
    let id: string | undefined;
    server.use(
      http.delete(`${baseUrl}/:id`, ({ params }) => {
        id = params.id as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await expect(deleteQrCode("d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11")).resolves.toBeUndefined();
    expect(id).toBe("d54f2f0e-4d3c-4a3b-9a3e-8f2c9c1f0a11");
  });
});
