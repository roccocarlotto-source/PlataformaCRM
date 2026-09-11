import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeExchangeRate, makeOrganizationSettings } from "../../test/organizationFixtures";
import { organizationKeys, useOrganizationSettings } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/organization`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("organizationKeys — key factory", () => {
  it("es un singleton: una sola clave de settings, sin lists() ni detail()", () => {
    expect(organizationKeys.all).toEqual(["organization"]);
    expect(organizationKeys.settings()).toEqual(["organization", "settings"]);
    expect("lists" in organizationKeys).toBe(false);
    expect("detail" in organizationKeys).toBe(false);
  });
});

describe("useOrganizationSettings", () => {
  it("pide GET /organization y expone la configuración con sus cotizaciones", async () => {
    let requests = 0;
    server.use(
      http.get(baseUrl, () => {
        requests += 1;
        return HttpResponse.json(
          makeOrganizationSettings({
            alternateCurrency: "UYU",
            exchangeRates: [makeExchangeRate({ rate: "41.25" })],
          }),
        );
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useOrganizationSettings(), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toBe(1);
    expect(result.current.data?.alternateCurrency).toBe("UYU");
    expect(result.current.data?.exchangeRates[0].rate).toBe("41.25");
    expect(queryClient.getQueryData(organizationKeys.settings())).toBe(result.current.data);
  });

  it("dos consumidores comparten la misma entrada de cache: un solo GET", async () => {
    // La página de configuración y la ficha de vehículo usan el mismo hook;
    // montados juntos no deberían duplicar la request.
    let requests = 0;
    server.use(
      http.get(baseUrl, () => {
        requests += 1;
        return HttpResponse.json(makeOrganizationSettings());
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const first = renderHook(() => useOrganizationSettings(), {
      wrapper: wrapperFor(queryClient),
    });
    const second = renderHook(() => useOrganizationSettings(), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(requests).toBe(1);
  });
});
