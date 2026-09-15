import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import {
  useConfirmActivity,
  useCreateActivity,
  useDeleteActivity,
  useUpdateActivity,
} from "./mutations";
import { activityKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/activities`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("activity/mutations — invalidación de cache", () => {
  it("create exitoso invalida SOLO activityKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeActivity(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateActivity(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ type: "CALL", subject: "Nueva", companyId: "co1" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("update exitoso invalida activityKeys.lists() y activityKeys.detail(id)", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeActivity())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateActivity("act1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate({ subject: "Editada" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.detail("act1") });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  // §29: Confirmar/Rechazar es un PATCH cuyo body es SOLO { confirmed }:
  // nunca completedAt (el backend rechaza combinarlos) ni confirmedAt/
  // confirmedById (los calcula el server).
  it("confirm/reject envían SOLO { confirmed } al id de la llamada e invalidan lists() y detail(id)", async () => {
    const bodies: { id: string; body: unknown }[] = [];
    server.use(
      http.patch(`${baseUrl}/:id`, async ({ params, request }) => {
        bodies.push({ id: params.id as string, body: await request.json() });
        return HttpResponse.json(makeActivity({ id: params.id as string }));
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useConfirmActivity(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ id: "act-ok", confirmed: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    result.current.mutate({ id: "act-no", confirmed: false });
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies).toEqual([
      { id: "act-ok", body: { confirmed: true } },
      { id: "act-no", body: { confirmed: false } },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.detail("act-ok") });
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.detail("act-no") }),
    );
  });

  it("delete exitoso invalida activityKeys.lists() y activityKeys.detail(id)", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteActivity(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate("act1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: activityKeys.detail("act1") });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("ninguna mutation invalida companyKeys/contactKeys/opportunityKeys/userKeys", async () => {
    server.use(
      http.post(baseUrl, () => HttpResponse.json(makeActivity(), { status: 201 })),
      http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeActivity())),
      http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const create = renderHook(() => useCreateActivity(), { wrapper: wrapperFor(queryClient) });
    create.result.current.mutate({ type: "CALL", subject: "Nueva", companyId: "co1" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));

    const update = renderHook(() => useUpdateActivity("act1"), {
      wrapper: wrapperFor(queryClient),
    });
    update.result.current.mutate({ subject: "Editada" });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));

    const del = renderHook(() => useDeleteActivity(), { wrapper: wrapperFor(queryClient) });
    del.result.current.mutate("act1");
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));

    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey: readonly unknown[] }).queryKey;
      expect(key[0]).toBe("activities");
    }
  });

  it("una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.post(baseUrl, () => HttpResponse.json({ error: { message: "falló" } }, { status: 500 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateActivity(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ type: "CALL", subject: "Nueva", companyId: "co1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
