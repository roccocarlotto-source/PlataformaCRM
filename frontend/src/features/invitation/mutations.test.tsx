import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeInvitation } from "../../test/invitationFixtures";
import { useCreateInvitation, useRevokeInvitation } from "./mutations";
import { invitationKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/invitations`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("invitation/mutations — invalidación de cache", () => {
  it("create exitoso invalida SOLO invitationKeys.lists()", async () => {
    server.use(http.post(baseUrl, () => HttpResponse.json(makeInvitation(), { status: 201 })));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateInvitation(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ email: "x@example.com", role: "USER" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: invitationKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("revoke exitoso invalida SOLO invitationKeys.lists()", async () => {
    server.use(http.delete(`${baseUrl}/:id`, () => HttpResponse.json(makeInvitation({ status: "REVOKED" }))));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRevokeInvitation(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate("inv1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: invitationKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
  });

  it("ninguna mutation invalida userKeys/companyKeys/etc (caches ajenos)", async () => {
    server.use(
      http.post(baseUrl, () => HttpResponse.json(makeInvitation(), { status: 201 })),
      http.delete(`${baseUrl}/:id`, () => HttpResponse.json(makeInvitation({ status: "REVOKED" }))),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const create = renderHook(() => useCreateInvitation(), { wrapper: wrapperFor(queryClient) });
    create.result.current.mutate({ email: "x@example.com", role: "USER" });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));

    const revoke = renderHook(() => useRevokeInvitation(), { wrapper: wrapperFor(queryClient) });
    revoke.result.current.mutate("inv1");
    await waitFor(() => expect(revoke.result.current.isSuccess).toBe(true));

    for (const call of invalidateSpy.mock.calls) {
      const key = (call[0] as { queryKey: readonly unknown[] }).queryKey;
      expect(key[0]).toBe("invitations");
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

    const { result } = renderHook(() => useCreateInvitation(), { wrapper: wrapperFor(queryClient) });
    result.current.mutate({ email: "x@example.com", role: "USER" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
