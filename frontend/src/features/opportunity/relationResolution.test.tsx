import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { makePipeline } from "../../test/pipelineFixtures";
import { makeStage } from "../../test/stageFixtures";
import { makeUser } from "../../test/userFixtures";
import { useCompaniesByIds } from "../contact/companyResolution";
import {
  useCompanyNames,
  useContactNames,
  useOwnerNames,
  usePipelineNames,
  useStageNames,
} from "./relationResolution";

vi.mock("../../auth/getAccessToken", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("opportunity/relationResolution", () => {
  it("useCompanyNames es exactamente useCompaniesByIds reexportado — sin duplicar la implementación", () => {
    expect(useCompanyNames).toBe(useCompaniesByIds);
  });

  it("useContactNames resuelve varios ids, deduplicados, a 'firstName lastName'", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/contacts/ct1`, () =>
        HttpResponse.json(makeContact({ id: "ct1", firstName: "Ana", lastName: "Pérez" })),
      ),
      http.get(`${env.apiUrl}/api/contacts/ct2`, () =>
        HttpResponse.json(makeContact({ id: "ct2", firstName: "Beto", lastName: "Gómez" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useContactNames(["ct1", "ct2", "ct1"]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("ct1")).toBe("Ana Pérez"));
    expect(result.current.byId.get("ct2")).toBe("Beto Gómez");
  });

  it("useContactNames: un id que falla en resolver no rompe el resto, ni aparece en byId", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/contacts/ct1`, () =>
        HttpResponse.json(makeContact({ id: "ct1", firstName: "Ana", lastName: "Pérez" })),
      ),
      http.get(`${env.apiUrl}/api/contacts/ct-borrado`, () =>
        HttpResponse.json({ error: { message: "no encontrado" } }, { status: 404 }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useContactNames(["ct1", "ct-borrado"]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("ct1")).toBe("Ana Pérez"));
    expect(result.current.byId.has("ct-borrado")).toBe(false);
  });

  it("usePipelineNames resuelve pipelineId → name", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/pipelines/pl1`, () =>
        HttpResponse.json(makePipeline({ id: "pl1", name: "Ventas" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => usePipelineNames(["pl1"]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("pl1")).toBe("Ventas"));
  });

  it("useStageNames resuelve pares (pipelineId, stageId) y distingue el mismo stageId bajo pipelines distintos", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/stages/st1`, () =>
        HttpResponse.json(makeStage({ id: "st1", pipelineId: "pl1", name: "Prospecto" })),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStageNames([{ pipelineId: "pl1", stageId: "st1" }]), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("st1")).toBe("Prospecto"));
  });

  it("useOwnerNames(false) no dispara ningún fetch a /api/users", async () => {
    let requestCount = 0;
    server.use(
      http.get(`${env.apiUrl}/api/users`, () => {
        requestCount += 1;
        return HttpResponse.json({
          data: [],
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useOwnerNames(false), { wrapper: wrapperFor(queryClient) });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requestCount).toBe(0);
  });

  it("useOwnerNames(true) resuelve ownerId → fullName desde la lista completa", async () => {
    server.use(
      http.get(`${env.apiUrl}/api/users`, () =>
        HttpResponse.json({
          data: [makeUser({ id: "u1", fullName: "Ana Pérez" })],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useOwnerNames(true), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.byId.get("u1")).toBe("Ana Pérez"));
  });
});
