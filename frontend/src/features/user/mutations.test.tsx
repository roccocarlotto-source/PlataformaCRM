import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeUser } from "../../test/userFixtures";
import { useDeleteUser, useUpdateUser } from "./mutations";
import { userKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/users`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("user/mutations — invalidación de cache", () => {
  it("update exitoso invalida SOLO userKeys.lists()", async () => {
    server.use(http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeUser())));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateUser("u1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ role: "ADMIN" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: userKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("delete exitoso invalida SOLO userKeys.lists()", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteUser(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate("u1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: userKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("ninguna mutation invalida caches ajenos (opportunityKeys/activityKeys/invitationKeys)", async () => {
    server.use(
      http.patch(`${baseUrl}/:id`, () => HttpResponse.json(makeUser())),
      http.delete(`${baseUrl}/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const update = renderHook(() => useUpdateUser("u1"), { wrapper: wrapperFor(queryClient) });
    update.result.current.mutate({ isActive: false });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));

    const del = renderHook(() => useDeleteUser(), { wrapper: wrapperFor(queryClient) });
    del.result.current.mutate("u2");
    await waitFor(() => expect(del.result.current.isSuccess).toBe(true));

    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey: readonly unknown[] }).queryKey;
      expect(key[0]).toBe("users");
    }
  });

  it("una mutation fallida no ejecuta ninguna invalidación", async () => {
    server.use(
      http.patch(`${baseUrl}/:id`, () =>
        HttpResponse.json({ error: { message: "falló" } }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useUpdateUser("u1"), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ role: "ADMIN" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
