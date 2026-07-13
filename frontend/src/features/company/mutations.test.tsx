import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeCompany } from "../../test/companyFixtures";
import { useCreateCompany, useDeleteCompany, useUpdateCompany } from "./mutations";
import { companyKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/companies`;

// QueryClient real (no mockeado) — solo se espía invalidateQueries, mismo
// criterio que auth/AuthContext.test.tsx con queryClient.clear().
function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("company/mutations — invalidación de cache", () => {
  it("B.6 create exitoso invalida companyKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeCompany(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateCompany(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ name: "Acme" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyKeys.lists() });
  });

  it("B.7 update exitoso invalida companyKeys.lists() y companyKeys.detail(id)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeCompany())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateCompany("c1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ name: "Acme 2" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyKeys.detail("c1") });
  });

  it("B.8 delete exitoso invalida companyKeys.lists()", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteCompany(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate("c1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: companyKeys.lists() });
  });

  it("B.9 una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "falló" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateCompany(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ name: "Acme" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
