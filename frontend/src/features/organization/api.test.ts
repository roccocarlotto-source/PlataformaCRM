import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeExchangeRate, makeOrganizationSettings } from "../../test/organizationFixtures";
import { getOrganizationSettings, updateOrganizationCurrency } from "./api";

// getAccessToken es la única frontera externa real de este módulo (vía
// Supabase) — se mockea acá igual que en source/api.test.ts.
// request()/ApiError corren sin mockear, contra MSW.
vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/organization`;

interface CapturedRequest {
  method: string;
  url: URL;
  body: unknown;
}

function captureRequests(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  const sample = makeOrganizationSettings({
    alternateCurrency: "UYU",
    exchangeRates: [makeExchangeRate()],
  });

  server.use(
    http.get(baseUrl, ({ request }) => {
      captured.push({ method: request.method, url: new URL(request.url), body: null });
      return HttpResponse.json(sample);
    }),
    http.patch(baseUrl, async ({ request }) => {
      const body = await request.clone().json();
      captured.push({ method: request.method, url: new URL(request.url), body });
      return HttpResponse.json(sample);
    }),
  );

  return captured;
}

describe("organization/api — contrato HTTP", () => {
  it("getOrganizationSettings pide GET /organization, sin :id, y devuelve la configuración con cotizaciones", async () => {
    const captured = captureRequests();
    const settings = await getOrganizationSettings();

    expect(captured[0].method).toBe("GET");
    expect(captured[0].url.pathname).toBe("/api/organization");
    expect(settings.preferredCurrency).toBe("USD");
    expect(settings.alternateCurrency).toBe("UYU");
    expect(settings.exchangeRates).toEqual([
      { targetCurrency: "UYU", rate: "40.5", rateDate: "2026-09-10" },
    ]);
  });

  it("updateOrganizationCurrency manda PATCH /organization con el body tal cual", async () => {
    const captured = captureRequests();
    await updateOrganizationCurrency({ preferredCurrency: "UYU", alternateCurrency: "USD" });

    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url.pathname).toBe("/api/organization");
    expect(captured[0].body).toEqual({ preferredCurrency: "UYU", alternateCurrency: "USD" });
  });

  it("null viaja como null (desconfigura esa moneda), no se omite", async () => {
    // El bug que este test previene: un JSON.stringify con undefined omitiría
    // la clave y el backend dejaría la moneda como estaba.
    const captured = captureRequests();
    await updateOrganizationCurrency({ alternateCurrency: null });

    expect(captured[0].body).toEqual({ alternateCurrency: null });
  });

  it("el 400 de monedas iguales se propaga con el mensaje del backend", async () => {
    server.use(
      http.patch(baseUrl, () =>
        HttpResponse.json(
          {
            error: {
              message: "La moneda de preferencia y la alternativa no pueden ser la misma",
            },
          },
          { status: 400 },
        ),
      ),
    );
    await expect(
      updateOrganizationCurrency({ preferredCurrency: "USD", alternateCurrency: "USD" }),
    ).rejects.toThrow("La moneda de preferencia y la alternativa no pueden ser la misma");
  });
});
