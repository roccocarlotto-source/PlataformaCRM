import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeActivity } from "../../test/activityFixtures";
import { activityKeys, useActivities, useActivity } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/activities`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("activityKeys — key factory", () => {
  it("list(query) produce la misma key para el mismo filtro y una distinta para otro", () => {
    const a = activityKeys.list({ page: 1, pageSize: 20 });
    const b = activityKeys.list({ page: 2, pageSize: 20 });
    const c = activityKeys.list({ page: 1, pageSize: 20 });

    expect(a).toEqual(c);
    expect(a).not.toEqual(b);
  });

  it("la key de list incluye el objeto completo de filtros/paginación/orden", () => {
    const key = activityKeys.list({
      page: 1,
      pageSize: 20,
      search: "x",
      type: "CALL",
      sortBy: "dueDate",
      sortOrder: "asc",
    });
    expect(key).toEqual([
      "activities",
      "list",
      { page: 1, pageSize: 20, search: "x", type: "CALL", sortBy: "dueDate", sortOrder: "asc" },
    ]);
  });

  it("detail(id) queda bajo un prefijo propio, aislado de lists()", () => {
    expect(activityKeys.lists()).toEqual(["activities", "list"]);
    expect(activityKeys.detail("act1")).toEqual(["activities", "detail", "act1"]);
  });
});

describe("useActivities / useActivity — aislamiento entre filtros", () => {
  it("dos queries con filtros distintos no comparten cache", async () => {
    const requestedTypes: (string | null)[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        const type = new URL(request.url).searchParams.get("type");
        requestedTypes.push(type);
        return HttpResponse.json({
          data: [makeActivity({ type: (type as "CALL" | "TASK") ?? "TASK" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const callQuery = renderHook(
      () => useActivities({ page: 1, pageSize: 20, type: "CALL" }),
      { wrapper: wrapperFor(queryClient) },
    );
    const taskQuery = renderHook(
      () => useActivities({ page: 1, pageSize: 20, type: "TASK" }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(callQuery.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(taskQuery.result.current.isSuccess).toBe(true));

    expect(requestedTypes).toContain("CALL");
    expect(requestedTypes).toContain("TASK");
    expect(callQuery.result.current.data?.data[0].type).toBe("CALL");
    expect(taskQuery.result.current.data?.data[0].type).toBe("TASK");
  });

  it("useActivity(undefined) no dispara ningún request — enabled: false", async () => {
    let requestCount = 0;
    server.use(
      http.get(`${baseUrl}/:id`, () => {
        requestCount += 1;
        return HttpResponse.json(makeActivity());
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useActivity(undefined), { wrapper: wrapperFor(queryClient) });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requestCount).toBe(0);
  });

  it("useActivity(id) dispara GET /activities/:id", async () => {
    server.use(
      http.get(`${baseUrl}/act1`, () =>
        HttpResponse.json(makeActivity({ id: "act1", subject: "Detalle real" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useActivity("act1"), { wrapper: wrapperFor(queryClient) });

    await waitFor(() => expect(result.current.data?.subject).toBe("Detalle real"));
  });
});
