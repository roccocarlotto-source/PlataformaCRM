import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeInvitation } from "../../test/invitationFixtures";
import { invitationKeys, useInvitations } from "./queries";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

const baseUrl = `${env.apiUrl}/api/invitations`;

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("invitationKeys — key factory", () => {
  it("list(query) produce la misma key para el mismo filtro y una distinta para otro", () => {
    const a = invitationKeys.list({ page: 1, pageSize: 20 });
    const b = invitationKeys.list({ page: 2, pageSize: 20 });
    const c = invitationKeys.list({ page: 1, pageSize: 20 });

    expect(a).toEqual(c);
    expect(a).not.toEqual(b);
  });

  it("es plana: lists()/detail no existe, mismo criterio que companyKeys/opportunityKeys", () => {
    expect(invitationKeys.all).toEqual(["invitations"]);
    expect(invitationKeys.lists()).toEqual(["invitations", "list"]);
    expect("detail" in invitationKeys).toBe(false);
  });
});

describe("useInvitations — aislamiento entre filtros", () => {
  it("dos queries con filtros de status distintos no comparten cache", async () => {
    const requestedStatuses: (string | null)[] = [];
    server.use(
      http.get(baseUrl, ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        requestedStatuses.push(status);
        return HttpResponse.json({
          data: [makeInvitation({ status: (status as "PENDING" | "REVOKED") ?? "PENDING" })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const pendingQuery = renderHook(
      () => useInvitations({ page: 1, pageSize: 20, status: "PENDING" }),
      { wrapper: wrapperFor(queryClient) },
    );
    const revokedQuery = renderHook(
      () => useInvitations({ page: 1, pageSize: 20, status: "REVOKED" }),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(pendingQuery.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(revokedQuery.result.current.isSuccess).toBe(true));

    expect(requestedStatuses).toContain("PENDING");
    expect(requestedStatuses).toContain("REVOKED");
    expect(pendingQuery.result.current.data?.data[0].status).toBe("PENDING");
    expect(revokedQuery.result.current.data?.data[0].status).toBe("REVOKED");
  });
});
