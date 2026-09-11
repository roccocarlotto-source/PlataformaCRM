import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOrganizationSettings } from "../../test/organizationFixtures";
import { useUpdateOrganizationCurrency } from "./mutations";
import { organizationKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/organization`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("organization/mutations — invalidación de cache", () => {
  it("update exitoso invalida SOLO organizationKeys.settings()", async () => {
    server.use(http.patch(baseUrl, () => HttpResponse.json(makeOrganizationSettings())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOrganizationCurrency(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ alternateCurrency: "UYU" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: organizationKeys.settings() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("una mutation fallida no ejecuta ninguna invalidación y expone el error", async () => {
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOrganizationCurrency(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ preferredCurrency: "USD", alternateCurrency: "USD" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "La moneda de preferencia y la alternativa no pueden ser la misma",
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
