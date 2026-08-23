import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeStage } from "../../test/stageFixtures";
import { useCreateStage, useDeleteStage, useUpdateStage } from "./mutations";
import { stageKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/stages`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("stage/mutations — invalidación de cache", () => {
  it("S7 create exitoso invalida stageKeys.byPipeline(pipelineId), no otro pipeline", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeStage(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateStage("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ pipelineId: "pl1", name: "Nueva" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: stageKeys.byPipeline("pl1") });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: stageKeys.byPipeline("otro-pl") });
  });

  it("S8 update exitoso invalida stageKeys.byPipeline(pipelineId) completo (aunque no toque order)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeStage())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateStage("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ id: "st1", input: { name: "Editada" } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: stageKeys.byPipeline("pl1") });
  });

  it("S9 delete exitoso invalida stageKeys.byPipeline(pipelineId) completo", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteStage("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate("st1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: stageKeys.byPipeline("pl1") });
  });

  it("S10 una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () =>
        HttpResponse.json({ error: { message: "falló" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateStage("pl1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ pipelineId: "pl1", name: "Nueva" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
