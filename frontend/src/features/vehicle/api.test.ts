import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeVehiclePhoto } from "../../test/vehicleFixtures";
import { listVehicles, reorderVehiclePhotos, uploadVehiclePhoto } from "./api";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/vehicles`;

describe("vehicle api", () => {
  it("status multi-selección viaja como query repetida, no unida por comas", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );

    await listVehicles({
      status: ["AVAILABLE", "RESERVED"],
      consignmentOnly: true,
      minPriceUsd: 0,
    });

    expect(captured?.searchParams.getAll("status")).toEqual(["AVAILABLE", "RESERVED"]);
    expect(captured?.searchParams.get("consignmentOnly")).toBe("true");
    // 0 es un mínimo válido: se manda (chequeo por !== undefined, no truthy).
    expect(captured?.searchParams.get("minPriceUsd")).toBe("0");
  });

  it("consignmentOnly false y sin status no agregan parámetros", async () => {
    let captured: URL | undefined;
    server.use(
      http.get(baseUrl, ({ request }) => {
        captured = new URL(request.url);
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }),
    );

    await listVehicles({ page: 2, consignmentOnly: false });

    expect(captured?.searchParams.has("consignmentOnly")).toBe(false);
    expect(captured?.searchParams.has("status")).toBe(false);
    expect(captured?.searchParams.get("page")).toBe("2");
  });

  it("uploadVehiclePhoto manda el archivo en el campo 'photo' y isCover como texto", async () => {
    let cuerpoCrudo: string | undefined;
    let contentType: string | null = null;
    server.use(
      http.post(`${baseUrl}/:id/photos`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        cuerpoCrudo = await request.text();
        return HttpResponse.json([makeVehiclePhoto()], { status: 201 });
      }),
    );

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "frente.jpg", {
      type: "image/jpeg",
    });
    const photos = await uploadVehiclePhoto("v1", file, { isCover: true });

    // Multipart real, con boundary generado por fetch (uploadFile, no request()).
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(cuerpoCrudo).toContain('name="photo"');
    expect(cuerpoCrudo).toContain('name="isCover"');
    expect(cuerpoCrudo).toContain("true");
    expect(photos).toHaveLength(1);
  });

  it("reorderVehiclePhotos hace PUT con { photoIds } en el orden dado", async () => {
    let method: string | undefined;
    let body: unknown;
    server.use(
      http.put(`${baseUrl}/:id/photos/reorder`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json([makeVehiclePhoto()]);
      }),
    );

    await reorderVehiclePhotos("v1", ["p2", "p1"]);

    expect(method).toBe("PUT");
    expect(body).toEqual({ photoIds: ["p2", "p1"] });
  });
});
