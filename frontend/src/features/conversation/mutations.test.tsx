import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeConversationDetail } from "../../test/conversationFixtures";
import { useCloseConversation } from "./mutations";
import { conversationKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const closeUrl = `${env.apiUrl}/api/conversations/conv-1/close`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("conversation/mutations — cierre manual (ítem 168)", () => {
  it("cerrar escribe la conversación entera en la cache del detalle e invalida los listados", async () => {
    const cerrada = makeConversationDetail({ status: "CLOSED" });
    server.use(http.post(closeUrl, () => HttpResponse.json(cerrada)));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCloseConversation("conv-1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(conversationKeys.detail("conv-1"))).toEqual(cerrada);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: conversationKeys.lists() });
  });

  it("un cierre fallido no toca la cache", async () => {
    server.use(
      http.post(closeUrl, () =>
        HttpResponse.json({ error: { message: "Conversación no encontrada" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCloseConversation("conv-1"), {
      wrapper: wrapperFor(queryClient),
    });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(conversationKeys.detail("conv-1"))).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
