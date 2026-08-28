import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeIngestionEvent } from "../../test/ingestionEventFixtures";
import { useRetryIngestionEvent } from "./mutations";
import { ingestionEventKeys } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const retryUrl = `${env.apiUrl}/api/ingestion-events/:id/retry`;

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useRetryIngestionEvent", () => {
  it("invalida el listado al reintentar con éxito", async () => {
    server.use(
      http.post(retryUrl, () =>
        HttpResponse.json(makeIngestionEvent({ id: "ev1", status: "PENDING" })),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRetryIngestionEvent(), {
      wrapper: wrapper(queryClient),
    });

    const evento = await result.current.mutateAsync("ev1");

    // Devuelve el evento ya en PENDING: el endpoint encola, no promueve.
    expect(evento.status).toBe("PENDING");
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ingestionEventKeys.lists() }),
    );
  });

  it("un 409 por carrera perdida NO invalida: no hubo transición que reflejar", async () => {
    server.use(
      http.post(retryUrl, () =>
        HttpResponse.json(
          { error: { message: "Solo se puede reprocesar un evento FAILED (está en PENDING)" } },
          { status: 409 },
        ),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRetryIngestionEvent(), {
      wrapper: wrapper(queryClient),
    });

    await expect(result.current.mutateAsync("ev1")).rejects.toThrow(/está en PENDING/);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
