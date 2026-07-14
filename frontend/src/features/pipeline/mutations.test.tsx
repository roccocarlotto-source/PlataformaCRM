import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makePipeline } from "../../test/pipelineFixtures";
import { useCreatePipeline, useDeletePipeline, useUpdatePipeline } from "./mutations";
import { pipelineKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/pipelines`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("pipeline/mutations — invalidación de cache", () => {
  it("P6 create con isDefault:true invalida pipelineKeys.all (puede desmarcar otro pipeline)", async () => {
    server.use(
      http.post(baseUrl, () => HttpResponse.json(makePipeline({ isDefault: true }), { status: 201 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreatePipeline(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ name: "Ventas", isDefault: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.all });
  });

  it("P6b create sin isDefault (u omitido) invalida solo pipelineKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makePipeline(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreatePipeline(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ name: "Ventas" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.lists() });
  });

  it("P7a update con isDefault:true invalida pipelineKeys.all", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makePipeline({ isDefault: true }))));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdatePipeline("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ isDefault: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.all });
  });

  it("P7b update con isDefault:false explícito invalida solo lists()+detail(id), no pipelineKeys.all", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makePipeline({ isDefault: false }))));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdatePipeline("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ isDefault: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.detail("pl1") });
  });

  it("P7c update que no toca isDefault (solo name) invalida solo lists()+detail(id)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makePipeline({ name: "Renombrado" }))));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdatePipeline("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ name: "Renombrado" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.detail("pl1") });
  });

  it("P8 delete exitoso invalida pipelineKeys.all (puede promover otro pipeline a default)", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeletePipeline(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate("pl1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: pipelineKeys.all });
  });

  it("P9 una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "falló" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreatePipeline(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ name: "Ventas" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
