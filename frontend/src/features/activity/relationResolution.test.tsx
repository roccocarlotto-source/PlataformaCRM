import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeOpportunity } from "../../test/opportunityFixtures";
import { useOpportunityNames } from "./relationResolution";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("activity/relationResolution — useOpportunityNames", () => {
  it("resuelve varios ids, deduplicados, a título", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/opportunities/op1`, () =>
        HttpResponse.json(makeOpportunity({ id: "op1", title: "Renovación anual" })),
      ),
      http.get(`${env.apiUrl}/api/opportunities/op2`, () =>
        HttpResponse.json(makeOpportunity({ id: "op2", title: "Expansión" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useOpportunityNames(["op1", "op2", "op1"]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("op1")).toBe("Renovación anual"));
    expect(result.current.byId.get("op2")).toBe("Expansión");
  });

  it("un id que falla en resolver no rompe el resto, ni aparece en byId", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/opportunities/op1`, () =>
        HttpResponse.json(makeOpportunity({ id: "op1", title: "Renovación anual" })),
      ),
      http.get(`${env.apiUrl}/api/opportunities/op-borrada`, () =>
        HttpResponse.json({ error: { message: "no encontrada" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useOpportunityNames(["op1", "op-borrada"]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("op1")).toBe("Renovación anual"));
    expect(result.current.byId.has("op-borrada")).toBe(false);
  });

  it("lista vacía no dispara ningún request", async () => {
    let requestCount = 0;
    server.use(
      http.get(`${env.apiUrl}/api/opportunities/:id`, () => {
        requestCount += 1;
        return HttpResponse.json(makeOpportunity());
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useOpportunityNames([]), { wrapper: wrapperFor(queryClient) });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requestCount).toBe(0);
  });
});
