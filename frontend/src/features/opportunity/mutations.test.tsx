import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { useCreateOpportunity, useDeleteOpportunity, useUpdateOpportunity } from "./mutations";
import { opportunityKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/opportunities`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("opportunity/mutations — invalidación de cache", () => {
  it("create exitoso invalida SOLO opportunityKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeOpportunity(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateOpportunity(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ title: "Nueva", pipelineId: "pl1", stageId: "st1", companyId: "co1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: opportunityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("update exitoso invalida opportunityKeys.lists() y opportunityKeys.detail(id)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeOpportunity())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateOpportunity("op1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ status: "WON" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: opportunityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: opportunityKeys.detail("op1") });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("delete exitoso invalida opportunityKeys.lists() y opportunityKeys.detail(id)", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteOpportunity(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate("op1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: opportunityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: opportunityKeys.detail("op1") });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("ninguna mutation invalida companyKeys/contactKeys/pipelineKeys/stageKeys/userKeys", async () => {
    server.use(
      http.post(baseUrl, () => HttpResponse.json(makeOpportunity(), { status: 201 })),
      http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeOpportunity())),
      http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const create = renderHook(() => useCreateOpportunity(), { wrapper: wrapperFor(queryClient) });
    create.result.current.mutate({ title: "Nueva", pipelineId: "pl1", stageId: "st1", companyId: "co1" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));

    const update = renderHook(() => useUpdateOpportunity("op1"), { wrapper: wrapperFor(queryClient) });
    update.result.current.mutate({ status: "WON" });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));

    const del = renderHook(() => useDeleteOpportunity(), { wrapper: wrapperFor(queryClient) });
    del.result.current.mutate("op1");
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));

    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey: readonly unknown[] }).queryKey;
      expect(key[0]).toBe("opportunities");
    }
  });

  it("una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "falló" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateOpportunity(), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ title: "Nueva", pipelineId: "pl1", stageId: "st1", companyId: "co1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
