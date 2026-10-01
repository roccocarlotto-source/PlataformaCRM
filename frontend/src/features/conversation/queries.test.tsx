import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeConversationDetail } from "../../test/conversationFixtures";
import {
  conversationKeys,
  DETAIL_REFETCH_MS,
  LIST_REFETCH_MS,
  useConversation,
  useConversations,
} from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Se mira la configuración del observer y no el reloj: esperar 5 s reales (o
// pelear con fake timers y msw) probaría a TanStack Query, no a esta feature.
// Lo que esta feature decide es el intervalo y que NO corra en segundo plano.
function opcionesDelObserver(queryClient: QueryClient, queryKey: readonly unknown[]) {
  const query = queryClient.getQueryCache().find({ queryKey });
  const observer = query?.observers[0];
  expect(observer).toBeDefined();
  return observer!.options;
}

describe("conversation/queries — polling", () => {
  it("el detalle abierto se refresca cada 5 s, solo con la pestaña visible", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/conversations/conv-1`, () =>
        HttpResponse.json(makeConversationDetail()),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useConversation("conv-1"), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const opciones = opcionesDelObserver(queryClient, conversationKeys.detail("conv-1"));
    expect(DETAIL_REFETCH_MS).toBe(5_000);
    expect(opciones.refetchInterval).toBe(DETAIL_REFETCH_MS);
    expect(opciones.refetchIntervalInBackground).toBeFalsy();
  });

  it("la lista se refresca cada 10 s, solo con la pestaña visible", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/conversations`, () =>
        HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = { page: 1 };

    const { result } = renderHook(() => useConversations(query), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const opciones = opcionesDelObserver(queryClient, conversationKeys.list(query));
    expect(LIST_REFETCH_MS).toBe(10_000);
    expect(opciones.refetchInterval).toBe(LIST_REFETCH_MS);
    expect(opciones.refetchIntervalInBackground).toBeFalsy();
  });
});
