import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server } from "../../test/msw/server";
import { env } from "../../config/env";
import { makeContact } from "../../test/contactFixtures";
import { makeOpportunityListItem } from "../../test/opportunityFixtures";
import { makeUser } from "../../test/userFixtures";
import { useCompaniesByIds } from "../contact/companyResolution";
import {
  useCompanyNames,
  useContactNames,
  nombreDeLaEmpresa,
  nombreDelContacto,
  useOwnerNames,
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

  it("nombreDelContacto: sin contacto, null; vigente, firstName lastName; borrado, —", () => {
    expect(nombreDelContacto(makeOpportunityListItem({ contactId: null }))).toBeNull();
    expect(nombreDelContacto(makeOpportunityListItem({ contactId: "ct1" }))).toBe("Ana Pérez");
    expect(nombreDelContacto(makeOpportunityListItem({ contactId: "ct1", contact: null }))).toBe(
      "—",
    );
  });

  it("nombreDeLaEmpresa: sin empresa, null; borrada o sin el módulo empresas, —", () => {
    const conEmpresa = makeOpportunityListItem({ companyId: "co1" });
    expect(
      nombreDeLaEmpresa(makeOpportunityListItem({ companyId: null, contactId: "ct1" }), true),
    ).toBeNull();
    expect(nombreDeLaEmpresa(conEmpresa, true)).toBe("Acme Corp");
    expect(nombreDeLaEmpresa(conEmpresa, false)).toBe("—");
    expect(
      nombreDeLaEmpresa(makeOpportunityListItem({ companyId: "co1", company: null }), true),
    ).toBe("—");
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
